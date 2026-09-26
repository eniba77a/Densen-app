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
import { internalActionGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { internal } from "./_generated/api";
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
  verifyPassword,
  assertPassword,
  VERIFY_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
  ageBandFromDob,
  LOCKOUT_WINDOW_MS,
} from "./authInternals";
import { SIGNUP_CONSENT_VERSIONS } from "./privacyInternals";
import { ensureNotificationDefaults } from "./notificationsWire";
import { notifySecurity } from "./socialEvents";
import {
  SESSION_TTL_MS,
  sessionValid,
  sessionRenewFrom,
  decideSignIn,
  tokenConsumable,
  decideChangePassword,
} from "./sessionsInternals";

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
  /** REQUIRED legal acceptances (separate checkboxes client-side). Fail-closed:
   *  an account cannot be created without all three granted. */
  acceptedTerms: v.boolean(),
  acceptedPrivacy: v.boolean(),
  acceptedGuidelines: v.boolean(),
});

export const signUp = mutationGeneric({
  args: SignUpArgs,
  handler: async (ctx, args) => {
    const now = new Date();

    // ---- 1. Boundary validation (shape, cheap rejects before any DB read) ----
    const email = normalizeEmail(args.email);
    if (email.length > 254) return { ok: false as const, error: "invalid_email" };
    if (!args.acceptedTerms || !args.acceptedPrivacy || !args.acceptedGuidelines) {
      return { ok: false as const, error: "consent_required" };
    }

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

    // Required consent records (user, type, version, timestamp) — one row per
    // document, version pinned SERVER-side, same transaction as the account.
    const consentBase = {
      userId: userId as never,
      granted: true,
      region: "app",
      source: "registration",
    };
    await ctx.db.insert("consents", { ...consentBase, type: "terms", version: SIGNUP_CONSENT_VERSIONS.terms, createdAt: now.getTime() });
    await ctx.db.insert("consents", { ...consentBase, type: "privacy", version: SIGNUP_CONSENT_VERSIONS.privacy, createdAt: now.getTime() });
    await ctx.db.insert("consents", { ...consentBase, type: "guidelines", version: SIGNUP_CONSENT_VERSIONS.guidelines, createdAt: now.getTime() });

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

    // Day 16 — age-aware notification defaults: children/teens start with a
    // quiet inbox (only the essentials + safety deliver). User choices made
    // later always win (ensure… never overwrites an existing row).
    await ensureNotificationDefaults(ctx.db, userId, rows.user.ageBand, now.getTime());

    // ---- 8. Email verification initiation (Resend via internal action) ----
    // Scheduling from a mutation is transactional: if the mutation commits,
    // the email action runs; if it aborts, it never runs.
    await ctx.scheduler.runAfter(0, internal.auth.sendAuthEmail, {
      kind: "email_verify" as const,
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

/* ---------------- email sending (internal action; Resend REST API) ---------------- */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

interface ResendResponse {
  id?: string;
  message?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/* ------------------------------------------------------------------ */
/*          Day 2 — sessions, verification, password flows             */
/* ------------------------------------------------------------------ */

/**
 * Session strategy (AUTH-PLAN.md §3): the client stores the RAW session token
 * only in memory; the database stores only its SHA-256 hash. Every request
 * sends the token; `getSessionByToken` validates it server-side (revocation,
 * expiry, sliding renewal). No cookies are involved in this prototype wiring.
 */

/* ---------------- shared email-sending internals ---------------- */

/**
 * Internal action for verification/reset mail. Registered via `internal`
 * references so the functions allow-list cannot enable public calling.
 * Soft-fails when RESEND_API_KEY is unset — signup/reset still succeed and
 * the platform operator enables sending by configuring the key (names only).
 */
export const sendAuthEmail = internalActionGeneric({
  args: {
    kind: v.union(v.literal("email_verify"), v.literal("password_reset")),
    email: v.string(),
    displayName: v.string(),
    token: v.string(),
  },
  handler: async (_ctx, args): Promise<{ sent: boolean; reason?: string; id?: string }> => {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? "Densen <onboarding@resend.dev>";
    if (!key) return { sent: false, reason: "email_not_configured" };

    const base = process.env.CONVEX_SITE_URL ?? "https://densen.app";
    const linkPath = args.kind === "email_verify" ? "verify-email" : "reset-password";
    const verifyUrl = `${base}/#/${linkPath}?token=${args.token}`;
    const subject =
      args.kind === "email_verify" ? "Verify your Densen email" : "Reset your Densen password";

    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: args.email,
        subject,
        html: renderAuthEmail(args.kind, args.displayName, verifyUrl, args.token),
      }),
    });
    if (!res.ok) return { sent: false, reason: `resend_http_${res.status}` }; // never log the body
    const data = (await res.json()) as ResendResponse;
    return { sent: true, id: data.id };
  },
});

function renderAuthEmail(kind: "email_verify" | "password_reset", displayName: string, verifyUrl: string, token: string): string {
  const headline = kind === "email_verify" ? `Welcome, ${displayName}` : `Password reset`;
  const cta = kind === "email_verify" ? "Verify my email" : "Choose a new password";
  const intro =
    kind === "email_verify"
      ? "Confirm your email to finish creating your Densen account."
      : "We received a request to reset your Densen password.";
  const tail =
    kind === "email_verify"
      ? "This link expires in 24 hours. If you didn't create a Densen account, you can ignore this email."
      : "This link expires in 60 minutes. If you didn't request a reset, ignore this email — your password is unchanged.";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0b0d10;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;color:#e8e6e1;">
    <p style="font-size:12px;letter-spacing:3px;color:#e3b341;margin:0 0 8px;">DENSEN</p>
    <h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(headline)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#b9b6ae;">${intro}</p>
    <p style="margin:24px 0;">
      <a href="${verifyUrl}" style="background:#e3b341;color:#171204;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none;">${cta}</a>
    </p>
    <p style="font-size:13px;color:#8d8a83;">Or paste this code in the app: <strong style="color:#e3b341;">${token}</strong></p>
    <p style="font-size:12px;color:#8d8a83;">${tail}</p>
  </div></body></html>`;
}

/** Issue a single-use token row + schedule its email. Shared by verify/resend/reset. */
async function issueToken(
  ctx: { db: { insert: (table: string, row: Record<string, unknown>) => Promise<string> } },
  scheduler: { runAfter: (delayMs: number, ref: any, args: any) => Promise<unknown> },
  purpose: "email_verify" | "password_reset",
  targetUserId: string,
  email: string,
  displayName: string,
  ttlMs: number,
  now: number
): Promise<void> {
  const raw = generateToken();
  await ctx.db.insert("verificationTokens", {
    purpose,
    targetUserId: targetUserId as never,
    tokenHash: await sha256Hex(raw),
    expiresAt: now + ttlMs,
    createdAt: now,
  });    await scheduler.runAfter(0, internal.auth.sendAuthEmail, {
      kind: purpose,
      email,
      displayName,
      token: raw,
    });
}

/* ---------------- sign in ---------------- */

export const signIn = mutationGeneric({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = normalizeEmail(args.email);

    // ---- lockout window lookup (by identifier, before any account read) ----
    // Bounded collect on the identifier index (this window is short) — the
    // generic-mode index builder here can't chain .eq().gte(). Housekeeping
    // keeps the table bounded: rows older than the window are pruned in-txn.
    const recentRaw = await ctx.db
      .query("loginAttempts")
      .withIndex("by_email_time", (q) => q.eq("emailNormalized", email))
      .collect();
    const recent = recentRaw.filter((a) => a.createdAt > now - LOCKOUT_WINDOW_MS);
    for (const old of recentRaw) {
      if (old.createdAt <= now - LOCKOUT_WINDOW_MS) await ctx.db.delete(old._id);
    }
    const failuresArr = recent.filter((a) => a.outcome !== "success");
    const failures = failuresArr.length;
    const lastFailureAt = failuresArr.sort((a, b) => b.createdAt - a.createdAt)[0]?.createdAt;

    // ---- account + credential lookup ----
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    let cred: Parameters<typeof decideSignIn>[1] = null;
    if (user) {
      const account = await ctx.db
        .query("authAccounts")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .unique();
      if (account && account.provider === "password") {
        cred = {
          secretHash: account.secretHash,
          emailVerified: account.emailVerified,
          userStatus: user.status,
          emailVerifiedAt: user.emailVerifiedAt,
          userPasswordUpdatedAt: user.passwordUpdatedAt ?? 0,
        };
      }
    }

    // ---- decide (pure core) ----
    const passwordOk =
      cred !== null && (await verifyPassword(args.password, cred.secretHash));
    const decision = decideSignIn(passwordOk, cred, { failures, lastFailureAt }, now);

    // ---- attempt log (server-side data; enables lockout + abuse analysis) ----
    const outcome = decision.ok
      ? "success"
      : decision.reason === "bad_password" || decision.reason === "no_account"
        ? decision.reason === "bad_password"
          ? "bad_password"
          : "unknown_email"
        : decision.reason === "locked"
          ? "rate_limited"
          : "bad_password"; // suspended/deleted log as failures too (no info leak)
    await ctx.db.insert("loginAttempts", {
      emailNormalized: email,
      outcome,
      createdAt: now,
    });

    if (!decision.ok) return { ok: false as const, error: "invalid_credentials" };

    // ---- success: mint session, refresh activity, audit ----
    const userId = user!._id;
    const rawSessionToken = generateToken();
    await ctx.db.insert("authSessions", {
      userId,
      tokenHash: await sha256Hex(rawSessionToken),
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    });
    await ctx.db.patch(userId, { lastActiveAt: now, updatedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      actorRole: user!.role,
      eventType: "auth_event",
      targetType: "user",
      targetId: userId,
      summary: "signin: session issued",
      createdAt: now,
    });

    return { ok: true as const, sessionToken: rawSessionToken };
  },
});

/* ---------------- sign out ---------------- */

export const signOut = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.sessionToken);
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session || !sessionValid(session, now)) return { ok: true as const }; // idempotent
    await ctx.db.patch(session._id, { revokedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: session.userId,
      eventType: "auth_event",
      targetType: "user",
      targetId: session.userId,
      summary: "signout: session revoked",
      createdAt: now,
    });
    return { ok: true as const };
  },
});

/* ---------------- session resolution ---------------- */

/**
 * The client's session source. Validates the presented token server-side,
 * applies the sliding renewal, and returns the minimal non-PII viewer plus
 * the (opaque) renewed expiry — never hash material, never email/DOB.
 */
export const getSessionByToken = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.sessionToken);
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session || !sessionValid(session, now)) return { valid: false as const };

    const user = await ctx.db.get(session.userId);
    if (!user || user.status === "deleted" || user.status === "suspended") {
      return { valid: false as const };
    }
    const renewTo = sessionRenewFrom(session, now);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("userId", (q) => q.eq("userId", session.userId))
      .unique();

    return {
      valid: true as const,
      session: renewTo ? { expiresAt: renewTo } : undefined,
      viewer: {
        userId: session.userId,
        role: user.role,
        userStatus: user.status,
        isMinor: user.isMinor,
        ageBand: user.ageBand,
        emailVerified: user.emailVerifiedAt !== undefined,
        handle: profile?.handle,
        displayName: profile?.displayName,
        avatarUrl: profile?.avatarUrl,
      },
    };
  },
});

/* ---------------- email verification ---------------- */

export const verifyEmail = mutationGeneric({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.token);
    const row = await ctx.db
      .query("verificationTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!tokenConsumable(row, now) || row!.purpose !== "email_verify") {
      return { ok: false as const, error: "invalid_token" };
    }
    const userId = row!.targetUserId;
    const user = await ctx.db.get(userId);
    if (!user || user.status === "deleted") return { ok: false as const, error: "invalid_token" };

    await ctx.db.patch(row!._id, { consumedAt: now }); // single-consume, same transaction
    await ctx.db.patch(userId, { emailVerifiedAt: now, updatedAt: now });
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (account) await ctx.db.patch(account._id, { emailVerified: true, updatedAt: now });

    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      eventType: "auth_event",
      targetType: "user",
      targetId: userId,
      summary: "email_verified",
      createdAt: now,
    });
    return { ok: true as const };
  },
});

export const resendVerification = mutationGeneric({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = normalizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    // Anti-enumeration: identical response whether or not the account exists.
    if (!user || user.status === "deleted" || user.emailVerifiedAt !== undefined) {
      return { ok: true as const };
    }
    await issueToken(ctx, ctx.scheduler, "email_verify", user._id, email, "there", VERIFY_TOKEN_TTL_MS, now);
    return { ok: true as const };
  },  
});

/** Session-authenticated re-send of the verification email (no email round-trip). */
export const resendVerificationSelf = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.sessionToken);
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session || !sessionValid(session, now)) return { ok: false as const, error: "unauthorized" };
    const user = await ctx.db.get(session.userId);
    if (!user || user.status === "deleted" || user.emailVerifiedAt !== undefined) {
      return { ok: true as const }; // nothing to do; no info leak
    }
    const profile = await ctx.db
      .query("profiles")
      .withIndex("userId", (q) => q.eq("userId", session.userId))
      .unique();
    await issueToken(ctx, ctx.scheduler, "email_verify", session.userId, user.email ?? "", profile?.displayName ?? "there", VERIFY_TOKEN_TTL_MS, now);
    return { ok: true as const };
  },
});

/* ---------------- forgot / reset password ---------------- */

export const requestPasswordReset = mutationGeneric({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const email = normalizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    // Anti-enumeration: identical response regardless of account existence.
    if (!user || user.status === "deleted") return { ok: true as const };
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!account) return { ok: true as const };
    await issueToken(ctx, ctx.scheduler, "password_reset", user._id, email, "there", RESET_TOKEN_TTL_MS, now);
    return { ok: true as const };
  },
});

export const resetPassword = mutationGeneric({
  args: { token: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    try {
      assertPassword(args.newPassword); // policy before any state change
    } catch {
      return { ok: false as const, error: "invalid_password" };
    }
    const tokenHash = await sha256Hex(args.token);
    const row = await ctx.db
      .query("verificationTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!tokenConsumable(row, now) || row!.purpose !== "password_reset") {
      return { ok: false as const, error: "invalid_token" };
    }
    const userId = row!.targetUserId;
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) return { ok: false as const, error: "invalid_token" };

    const secretHash = await hashPassword(args.newPassword);
    await ctx.db.patch(row!._id, { consumedAt: now });
    await ctx.db.patch(account._id, { secretHash, updatedAt: now });
    await ctx.db.patch(userId, { passwordUpdatedAt: now, updatedAt: now });

    // Password change revokes ALL existing sessions (session hygiene).
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .collect();
    for (const s of sessions) {
      if (s.revokedAt === undefined) await ctx.db.patch(s._id, { revokedAt: now });
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      eventType: "auth_event",
      targetType: "user",
      targetId: userId,
      summary: "password_reset_via_token",
      createdAt: now,
    });
    return { ok: true as const };
  },
});

/* ---------------- change password (authenticated) ---------------- */

export const changePassword = mutationGeneric({
  args: { sessionToken: v.string(), currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.sessionToken);
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session || !sessionValid(session, now)) return { ok: false as const, error: "unauthorized" };

    const account = await ctx.db
      .query("authAccounts")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .unique();
    if (!account) return { ok: false as const, error: "unauthorized" };

    const currentOk = await verifyPassword(args.currentPassword, account.secretHash);
    const decision = decideChangePassword(currentOk, args.newPassword, args.currentPassword);
    if (!decision.ok) {
      return {
        ok: false as const,
        error: decision.error === "wrong_current" ? "wrong_current" : "invalid_password",
      };
    }

    const secretHash = await hashPassword(args.newPassword);
    await ctx.db.patch(account._id, { secretHash, updatedAt: now });
    await ctx.db.patch(session.userId, { passwordUpdatedAt: now, updatedAt: now });

    // Revoke every OTHER session; the caller's own session stays alive.
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_user_time", (q) => q.eq("userId", session.userId))
      .collect();
    for (const s of sessions) {
      if (s._id !== session._id && s.revokedAt === undefined) await ctx.db.patch(s._id, { revokedAt: now });
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: session.userId,
      eventType: "auth_event",
      targetType: "user",
      targetId: session.userId,
      summary: "password_changed",
      createdAt: now,
    });

    // Day 16 — SECURITY notification: the security category is never mutable,
    // so this always delivers to the notification center (in-app only; no
    // fake push).
    await notifySecurity(ctx.db, { type: "security_password_changed", userId: session.userId, now });
    return { ok: true as const };
  },
});

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
