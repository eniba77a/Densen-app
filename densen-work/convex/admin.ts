/**
 * DENSEN — Admin module (wire layer).
 * ====================================
 * Staff-only operations. Authorization is fail-closed: every function
 * resolves the caller from the SESSION TOKEN and enforces `requireRole`
 * before any read or write. Verification is the ONLY path to the teacher
 * role — users can never self-verify (enforced here and in tests).
 */
import { internalMutationGeneric, mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { sha256Hex } from "./authInternals";
import { sessionValid, decideVerification } from "./sessionsInternals";
import { requireRole, type Caller } from "./security";

// Convex actions/mutations run in a managed server runtime that provides
// `process.env`. Declared locally because the browser-oriented tsconfig has
// no @types/node.
declare const process: { env: Record<string, string | undefined> };

type AdminDbReader = {
  get: (id: any) => Promise<any>;
  query: (table: string) => {
    withIndex: (name: string, f: (q: any) => any) => {
      unique: () => Promise<any>;
      collect: () => Promise<any[]>;
    };
  };
};

type AdminDb = AdminDbReader & {
  insert: (table: string, row: Record<string, unknown>) => Promise<string>;
  patch: (id: any, patch: Record<string, unknown>) => Promise<void>;
};

/** Shared helper: session token → Caller (or throw). Staff gates call this first. */
async function requireSessionCaller(ctx: { db: AdminDbReader }, token: string): Promise<Caller> {
  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const session = (await ctx.db
    .query("authSessions")
    .withIndex("by_token_hash", (q: any) => q.eq("tokenHash", tokenHash))
    .unique()) as { userId: string; revokedAt?: number; expiresAt: number } | null;
  if (!session || !sessionValid(session, now)) throw new Error("UNAUTHORIZED");
  const user = (await ctx.db.get(session.userId)) as
    | { _id: string; role: Caller["role"]; status: Caller["userStatus"] }
    | null;
  if (!user || user.status === "deleted" || user.status === "suspended") throw new Error("UNAUTHORIZED");
  return { userId: user._id, role: user.role, userStatus: user.status };
}

/* ------------------------------------------------------------------ */
/*                   Teacher verification (admin-only)                 */
/* ------------------------------------------------------------------ */

export const verificationQueue = queryGeneric({
  args: { adminSessionToken: v.string() },
  handler: async (ctx: { db: AdminDbReader }, args: { adminSessionToken: string }) => {
    const admin = await requireSessionCaller(ctx, args.adminSessionToken);
    requireRole(admin, "admin"); // fail-closed staff gate

    const rows = (await ctx.db
      .query("teacherProfiles")
      .withIndex("by_status", (q: any) => q.eq("status", "pending"))
      .collect()) as {
      _id: string; userId: string; displayName: string; styles: string[]; biography?: string; createdAt: number;
    }[];
    // Minimal projection: verification documents are never returned in list form.
    return {
      ok: true as const,
      queue: rows.map((r) => ({
        teacherProfileId: r._id,
        userId: r.userId,
        displayName: r.displayName,
        styles: r.styles,
        biography: r.biography,
        submittedAt: r.createdAt,
      })),
    };
  },
});

export const decideVerificationAction = mutationGeneric({
  args: {
    adminSessionToken: v.string(),
    teacherProfileId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx: { db: AdminDb }, args) => {
    const admin = await requireSessionCaller(ctx, args.adminSessionToken);
    requireRole(admin, "admin"); // fail-closed staff gate

    const row = (await ctx.db.get(args.teacherProfileId)) as
      | { _id: string; userId: string; status: string }
      | null;
    if (!row) return { ok: false as const, error: "not_found" };

    // PENDING → VERIFIED | REJECTED only (pure core; tested).
    const d = decideVerification(row.status, args.decision);
    if (!d.ok) return { ok: false as const, error: d.error };
    const now = Date.now();

    await ctx.db.patch(row._id, {
      status: d.next,
      verifiedBy: d.next === "verified" ? admin.userId : undefined,
      verifiedAt: d.next === "verified" ? now : undefined,
      updatedAt: now,
    });

    // Role grant/revoke in the SAME transaction as the status flip.
    const user = (await ctx.db.get(row.userId)) as { _id: string; role: Caller["role"] } | null;
    if (user && user.role !== "admin" && user.role !== "moderator") {
      const targetRole = d.next === "verified" ? "teacher" : "user";
      if (user.role !== targetRole) {
        await ctx.db.patch(user._id, { role: targetRole });
      }
      await ctx.db.insert("roles", {
        userId: user._id,
        role: targetRole,
        grantedBy: admin.userId,
        reason: d.next === "verified" ? "teacher_verification_approved" : "teacher_verification_rejected",
        createdAt: now,
      });
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: admin.userId,
      actorRole: admin.role,
      eventType: "teacher_verification",
      targetType: "teacher_profile",
      targetId: row._id,
      summary: `teacher_verification_${d.next}${args.reason ? "" : ""}`,
      createdAt: now,
    });
    return { ok: true as const, next: d.next };
  },
});

/* ------------------------------------------------------------------ */
/*                  First-admin bootstrap (secret-gated)               */
/* ------------------------------------------------------------------ */

/**
 * Creates the first admin when none exists. Gated by ADMIN_BOOTSTRAP_SECRET
 * from the server environment (never in code, never in the client). Once an
 * admin exists, all further role management flows through admin-only functions.
 * Internal function: not callable from the client API at all.
 */
export const bootstrapFirstAdmin = internalMutationGeneric({
  args: { email: v.string(), secret: v.string() },
  handler: async (ctx: { db: AdminDb }, args) => {
    const expected = process.env.ADMIN_BOOTSTRAP_SECRET;
    if (!expected || args.secret !== expected) return { ok: false as const, error: "invalid_secret" };
    const email = args.email.trim().toLowerCase();
    const existingAdmins = await ctx.db
      .query("users")
      .withIndex("by_role", (q: any) => q.eq("role", "admin"))
      .collect();
    if (existingAdmins.length > 0) return { ok: false as const, error: "admin_exists" };

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q: any) => q.eq("email", email))
      .unique();
    if (!user) return { ok: false as const, error: "no_such_user" };

    await ctx.db.patch(user._id, { role: "admin", updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      actorRole: "admin",
      eventType: "auth_event",
      targetType: "user",
      targetId: user._id,
      summary: "bootstrap_first_admin",
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});
