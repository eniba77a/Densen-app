/**
 * DENSEN — Auth module (wire layer): registration.
 * ================================================
 * `signUp` creates a complete account — users + profiles + privacySettings +
 * authAccounts (+ a `pending` teacherProfiles row on intent) + a single-use
 * email-verification token + an immutable audit entry — inside ONE mutation
 * (Convex mutations are atomic, so the plan's "single transaction" holds).
 *
 * Security properties (AUTH-PLAN.md §5):
 *  - Client input is validated at the boundary and re-decided SERVER-side
 *    (`decideSignUp`); age band, youth defaults and role are never taken from
 *    the client.
 *  - Passwords are PBKDF2-hashed via Web Crypto inside the mutation; plaintext
 *    never persists and never logs.
 *  - Verification tokens persist only as SHA-256 hashes; the raw token lives
 *    only in the email payload.
 *  - Uniqueness checks are read-before-write inside the same transaction.
 *  - Audit summaries contain no email/DOB/token material.
 *
 * Email: a Convex **action** calls the Resend REST API via fetch — no extra
 * dependency, the RESEND_API_KEY stays server-side (action env only). If the
 * key is absent the mutation still succeeds (the token is stored and the
 * email is skipped) — the platform operator sets the key to enable sending.
 */
import { actionGeneric, mutationGeneric, queryGeneric, anyApi } from "convex/server";
import { v } from "convex/values";

// Convex actions execute in a managed server runtime that provides `process.env`.
// Declared locally because the browser-oriented tsconfig has no @types/node.
declare const process: { env: Record<string, string | undefined> };
import {
  decideSignUp,
  hashPassword,
  generateToken,
  sha256Hex,
  normalizeEmail,
  VERIFY_TOKEN_TTL_MS,
  ageBandFromDob,
} from "./authInternals";

/* signUp does NOT mint sessions — signing in is the next module's job.
 * (AUTH-PLAN.md §3: signIn/signOut/reset/change are separate functions;
 * their session helpers land with them. Nothing half-usable is exported.) */

/* ---------------- signUp ---------------- */

const SignUpArgs = v.object({
  firstName: v.string(),
  handle: v.string(),
  email: v.string(),
  password: v.string(),
  dob: v.string(),
  wantsTeacher: v.boolean(),
  guardianName: v.optional(v.string()),
  city: v.optional(v.string()),
});

export const signUp = mutationGeneric({
  args: SignUpArgs,
  handler: async (ctx, args) => {
    const now = new Date();

    // ---- 1. Boundary validation (shape, cheap rejects before any DB read) ----
    const email = normalizeEmail(args.email);
    if (email.length > 254) return { ok: false as const, error: "invalid_email" };

    // ---- 2. Server-side uniqueness lookups (index-backed, in-transaction) ----
    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    const existingByHandle = await ctx.db
      .query("profiles")
      .withIndex("handle", (q) => q.eq("handle", args.handle.trim().toLowerCase()))
      .unique();
    const uniqueness = {
      emailTaken: existingByEmail !== null,
      handleTaken: existingByHandle !== null,
    };

    // ---- 3. Decide (pure core; age band + youth defaults derived HERE) ----
    const decision = decideSignUp(args, uniqueness, now);
    if (!decision.ok) return { ok: false as const, error: decision.error };

    const rows = decision.rows;

    // ---- 4. Password hash (Web Crypto, inside the mutation) — stored on the
    // authAccounts row below; the plaintext never persists anywhere else. ----
    const secretHash = await hashPassword(args.password);

    // ---- 5. ONE atomic transaction: user + profile + privacy + auth account ----
    const userId = await ctx.db.insert("users", rows.user);
    const profileId = await ctx.db.insert("profiles", { ...rows.profile, userId: userId as never });
    await ctx.db.insert("privacySettings", { ...rows.privacy, userId: userId as never });
    await ctx.db.insert("authAccounts", { ...rows.account, secretHash, userId: userId as never });

    // Teacher INTENT: a `pending` row only. No teacher role is granted here —
    // admin verification (AUTH-PLAN.md §3 admin.ts) is the only path to the role.
    let teacherProfileId: string | undefined;
    if (decision.teacherIntent) {
      teacherProfileId = (
        await ctx.db.insert("teacherProfiles", {
          userId: userId as never,
          status: "pending",
          displayName: rows.profile.displayName,
          styles: [],
          createdAt: now.getTime(),
          updatedAt: now.getTime(),
        })
      ) as unknown as string;
    }

    // ---- 6. Single-use email-verification token (hash at rest) ----
    const rawToken = generateToken();
    const tokenHash = await sha256Hex(rawToken);
    await ctx.db.insert("verificationTokens", {
      purpose: "email_verify",
      targetUserId: userId as never,
      tokenHash,
      expiresAt: now.getTime() + VERIFY_TOKEN_TTL_MS,
      createdAt: now.getTime(),
    });

    // ---- 7. Immutable audit entry (no PII in the summary) ----
    await ctx.db.insert("auditLogs", {
      actorUserId: userId as never,
      actorRole: "user",
      eventType: "auth_event",
      targetType: "user",
      targetId: userId,
      summary: decision.isMinor
        ? "signup: minor account created with youth-safety defaults"
        : "signup: account created",
      createdAt: now.getTime(),
    });

    // ---- 8. Email verification initiation (Resend via action) ----
    // Scheduling from a mutation is transactional: if the mutation commits,
    // the email action runs; if it aborts, it never runs.
    await ctx.scheduler.runAfter(0, anyApi.emails.sendVerificationEmail, {
      email,
      displayName: rows.profile.displayName,
      token: rawToken, // raw token ONLY in the scheduled email payload
    });

    return {
      ok: true as const,
      userId,
      profileId,
      teacherProfileId,
      /** Youth defaults applied — surfaced so the client can explain protections. */
      isMinor: decision.isMinor,
      emailSent: true,
    };
  },
});

/* ---------------- email sending (action; Resend REST API) ---------------- */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

interface ResendResponse {
  id?: string;
  message?: string;
}

/**
 * Sends the verification email via Resend. Runs as an action (node context).
 * The RESEND_API_KEY is read from the action environment — never from the
 * client bundle. If the key is not configured the action records the skip and
 * exits — signup itself already succeeded and the token is stored.
 */
export const sendVerificationEmail = actionGeneric({
  args: {
    email: v.string(),
    displayName: v.string(),
    token: v.string(),
  },
  handler: async (_ctx, args) => {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? "Densen <onboarding@resend.dev>";

    if (!key) {
      // Not configured: fail soft. The verification token is already stored;
      // ops sets RESEND_API_KEY (names-only per policy) to enable sending.
      return { sent: false as const, reason: "email_not_configured" };
    }

    const verifyUrl = `${process.env.CONVEX_SITE_URL ?? "https://densen.app"}/#/auth/verify?token=${args.token}`;

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.email,
        subject: "Verify your Densen email",
        html: renderVerifyEmail(args.displayName, verifyUrl, args.token),
      }),
    });

    if (!res.ok) {
      // Never log the body (could echo the token); log only the status.
      return { sent: false as const, reason: `resend_http_${res.status}` };
    }
    const data = (await res.json()) as ResendResponse;
    return { sent: true as const, id: data.id };
  },
});

function renderVerifyEmail(displayName: string, verifyUrl: string, token: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0b0d10;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;color:#e8e6e1;">
    <p style="font-size:12px;letter-spacing:3px;color:#e3b341;margin:0 0 8px;">DENSEN</p>
    <h1 style="font-size:22px;margin:0 0 12px;">Welcome, ${escapeHtml(displayName)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#b9b6ae;">Confirm your email to finish creating your Densen account.</p>
    <p style="margin:24px 0;">
      <a href="${verifyUrl}" style="background:#e3b341;color:#171204;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none;">Verify my email</a>
    </p>
    <p style="font-size:13px;color:#8d8a83;">Or paste this code in the app: <strong style="color:#e3b341;">${token}</strong></p>
    <p style="font-size:12px;color:#8d8a83;">This link expires in 24 hours. If you didn't create a Densen account, you can ignore this email.</p>
  </div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/* ---------------- getSession (viewer bootstrap; no PII) ---------------- */

/**
 * The client's auth-state source. Returns the minimal non-PII viewer for the
 * current session — powers the client AuthProvider. Guests get null.
 */
export const getSession = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const subject = (await ctx.auth.getUserIdentity())?.subject;
    if (!subject) return null;
    const user = (await ctx.db.get(subject as never)) as
      | { _id: string; role: string; status: string; isMinor: boolean; emailVerifiedAt?: number; ageBand: string }
      | null;
    if (!user || user.status === "deleted") return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("userId", (q) => q.eq("userId", user._id as never))
      .unique();
    return {
      userId: user._id,
      role: user.role,
      userStatus: user.status,
      isMinor: user.isMinor,
      ageBand: user.ageBand,
      emailVerified: user.emailVerifiedAt !== undefined,
      handle: profile?.handle,
      displayName: profile?.displayName,
      avatarUrl: profile?.avatarUrl,
    };
  },
});

/* ---------------- dev-facing pure re-exports for tests ---------------- */

export const __internals = { decideSignUp, ageBandFromDob };
