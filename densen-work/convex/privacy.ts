/**
 * DENSEN — Privacy wire layer (Day 3).
 * =====================================
 * The Privacy Center's backend: session-token identity (fail-closed), the
 * pure cores in `privacyInternals.ts` as the only decision path, PII-minimal
 * responses (band, never the DOB), append-only consent + audit records.
 *
 * No secrets are read anywhere; identity comes from the caller's own session.
 */
import { queryGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import { youthDefaultsFor } from "./authInternals";
import {
  ageCategoryFromBand,
  consentVersionFor,
  decideConsentRecord,
  decidePermissionRecord,
  decidePrivacyUpdate,
  type AgeBand,
  type ConsentType,
  type DevicePermissionState,
  type MessagesFrom,
} from "./privacyInternals";

/* --------------------------- shared helpers --------------------------- */

/** The caller row + its privacySettings row (fail-closed on session/user). */
async function callerWithPrivacy(
  db: { get: any; query: (t: string) => any },
  sessionToken: string
): Promise<{ userId: string; role: string; band: AgeBand; isMinor: boolean; privacyId?: string; privacy: any } | null> {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const user = await db.get(caller.userId);
  if (!user) return null;
  const privacy = await db
    .query("privacySettings")
    .withIndex("by_user", (q: any) => q.eq("userId", caller.userId))
    .unique();
  return {
    userId: caller.userId,
    role: caller.role,
    band: user.ageBand as AgeBand,
    isMinor: Boolean(user.isMinor),
    privacyId: privacy?._id,
    privacy: privacy ?? null,
  }
}

async function audit(
  db: { insert: (t: string, row: Record<string, unknown>) => Promise<unknown> },
  userId: string,
  role: string,
  eventType: string,
  summary: string
): Promise<void> {
  await db.insert("auditLogs", {
    actorUserId: userId as never,
    actorRole: role as never,
    eventType,
    targetType: "privacy",
    targetId: userId,
    summary,
    createdAt: Date.now(),
  });
}

/* --------------------------- privacy center read --------------------------- */

export const getPrivacyCenter = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const c = await callerWithPrivacy(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" };

    const profile = await ctx.db
      .query("profiles")
      .withIndex("userId", (q: any) => q.eq("userId", c.userId))
      .unique();

    // Consent history (append-only) — own data, audit-grade transparency.
    const rows = await ctx.db
      .query("consents")
      .withIndex("by_user", (q: any) => q.eq("userId", c.userId))
      .collect();
    rows.sort((a: any, b: any) => b.createdAt - a.createdAt);
    const current: Record<string, { granted: boolean; version: string }> = {};
    for (const r of rows) {
      if (!current[r.type]) current[r.type] = { granted: r.granted, version: r.version };
    }
    const history = rows.slice(0, 100).map((r: any) => ({
      type: r.type as string,
      granted: r.granted as boolean,
      version: r.version as string,
      region: r.region as string,
      source: r.source as string,
      createdAt: r.createdAt as number,
    }));

    // Device permissions — one indexed lookup per known permission.
    const perms: Record<string, DevicePermissionState> = {};
    for (const p of ["camera", "microphone", "photos", "location", "notifications"] as const) {
      const row = await ctx.db
        .query("devicePermissions")
        .withIndex("by_user_permission", (q: any) => q.eq("userId", c.userId).eq("permission", p))
        .unique();
      if (row) perms[p] = row.state as DevicePermissionState;
    }

    // Blocked accounts — public projection only (handle/displayName/avatar).
    const blocks = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", c.userId))
      .collect();
    const blocked: { userId: string; handle: string; displayName: string }[] = [];
    for (const b of blocks) {
      const p = await ctx.db
        .query("profiles")
        .withIndex("userId", (q: any) => q.eq("userId", b.blockedId))
        .unique();
      if (p) blocked.push({ userId: b.blockedId, handle: p.handle, displayName: p.displayName });
    }

    const privacy = c.privacy;
    return {
      ok: true as const,
      viewer: {
        band: c.band,
        ageCategory: ageCategoryFromBand(c.band),
        isMinor: c.isMinor,
        role: c.role,
      },
      privacy: {
        privateAccount: privacy?.privateAccount ?? true,
        messagesFrom: (privacy?.messagesFrom ?? "followers") as MessagesFrom,
        commentFilter: privacy?.commentFilter ?? true,
        discoverableByHandle: privacy?.discoverableByHandle ?? false,
        showCity: privacy?.showCity ?? false,
        personalization: privacy?.personalization ?? false,
        mentionsFrom: (privacy?.mentionsFrom ?? "followers") as MessagesFrom,
        tagsFrom: (privacy?.tagsFrom ?? "followers") as MessagesFrom,
        notificationsEnabled: privacy?.notificationsEnabled ?? false,
      },
      reuse: {
        allowRemix: profile?.allowRemix ?? false,
        allowDuet: profile?.allowDuet ?? false,
        allowDownloads: profile?.allowDownloads ?? false,
        city: privacy?.showCity ? profile?.city : undefined,
      },
      consents: { current, history },
      devicePermissions: perms,
      blocked,
    };
  },
});

/* --------------------------- privacy settings write --------------------------- */

export const updatePrivacySettings = mutationGeneric({
  args: {
    sessionToken: v.string(),
    patch: v.object({
      privateAccount: v.optional(v.boolean()),
      messagesFrom: v.optional(v.union(v.literal("everyone"), v.literal("followers"), v.literal("none"))),
      commentFilter: v.optional(v.boolean()),
      discoverableByHandle: v.optional(v.boolean()),
      showCity: v.optional(v.boolean()),
      personalization: v.optional(v.boolean()),
      mentionsFrom: v.optional(v.union(v.literal("everyone"), v.literal("followers"), v.literal("none"))),
      tagsFrom: v.optional(v.union(v.literal("everyone"), v.literal("followers"), v.literal("none"))),
      notificationsEnabled: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await callerWithPrivacy(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    // Server-side decision: unknown keys rejected at the boundary by v.object;
    // band-hostile values clamped by the pure core (minors never loosen safety).
    const decision = decidePrivacyUpdate(args.patch, c.band);
    if (!decision.ok) return { ok: false as const, error: decision.error };
    const cleaned = decision.cleaned;

    // Missing row (pre-delta accounts): create from the age defaults first.
    if (!c.privacyId) {
      const d = youthDefaultsFor(c.band);
      c.privacyId = await ctx.db.insert("privacySettings", {
        userId: c.userId as never,
        privateAccount: d.privateAccount,
        messagesFrom: d.messagesFrom,
        commentFilter: d.commentFilter,
        discoverableByHandle: d.discoverableByHandle,
        showCity: d.showCity,
        personalization: false,
        updatedAt: now,
      });
    }

    const dbPatch: Record<string, unknown> = { updatedAt: now };
    for (const [k, val] of Object.entries(cleaned)) {
      if (val !== undefined) dbPatch[k] = val;
    }
    await ctx.db.patch(c.privacyId as never, dbPatch);
    await audit(ctx.db, c.userId, c.role, "privacy_update", Object.keys(cleaned).sort().join(","));

    // Effective values — the client renders what the SERVER decided.
    const updated = await ctx.db.get(c.privacyId as never);
    return { ok: true as const, effective: updated };
  },
});

/* --------------------------- consent recording --------------------------- */

export const recordConsent = mutationGeneric({
  args: {
    sessionToken: v.string(),
    type: v.string(),
    granted: v.boolean(),
    source: v.string(),
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await callerWithPrivacy(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    const decision = decideConsentRecord(args.type, args.granted, c.band);
    if (!decision.ok) return { ok: false as const, error: decision.error };

    const version = consentVersionFor(args.type as ConsentType);
    const region = (args.region ?? "unknown").slice(0, 8);
    const source = args.source.slice(0, 60);
    await ctx.db.insert("consents", {
      userId: c.userId as never,
      type: args.type,
      granted: args.granted,
      version,
      region,
      source,
      createdAt: now,
    });

    // Personalization consent drives the privacySettings flag (single truth).
    if (args.type === "personalization" && c.privacyId) {
      await ctx.db.patch(c.privacyId as never, { personalization: args.granted, updatedAt: now });
    }

    await audit(ctx.db, c.userId, c.role, "consent_change", `${args.type}:${args.granted ? "granted" : "withdrawn"}@${version}`);
    return { ok: true as const };
  },
});

/* --------------------------- device permissions --------------------------- */

/** Records the OUTCOME of a real OS permission prompt (never fabricates one). */
export const setDevicePermission = mutationGeneric({
  args: {
    sessionToken: v.string(),
    permission: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await callerWithPrivacy(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    const decision = decidePermissionRecord(args.permission, args.state);
    if (!decision.ok) return { ok: false as const, error: decision.error };

    const existing = await ctx.db
      .query("devicePermissions")
      .withIndex("by_user_permission", (q: any) => q.eq("userId", c.userId).eq("permission", args.permission))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { state: args.state, updatedAt: now });
    } else {
      await ctx.db.insert("devicePermissions", {
        userId: c.userId as never,
        permission: args.permission,
        state: args.state,
        requestedAt: now,
        updatedAt: now,
      });
    }
    await audit(ctx.db, c.userId, c.role, "device_permission", `${args.permission}:${args.state}`);
    return { ok: true as const };
  },
});

/* --------------------------- blocking --------------------------- */

async function userExists(db: { get: any }, userId: string): Promise<boolean> {
  const u = await db.get(userId as never);
  return Boolean(u);
}

async function userRoleOf(db: { get: any }, userId: string): Promise<string | null> {
  const u = await db.get(userId as never);
  return u ? (u.role as string) : null;
}

export const blockUser = mutationGeneric({
  args: {
    sessionToken: v.string(),
    targetUserId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await callerWithPrivacy(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };
    if (args.targetUserId === c.userId) return { ok: false as const, error: "cannot_block_self" as const };
    if (!(await userExists(ctx.db, args.targetUserId))) return { ok: false as const, error: "unknown_user" as const };

    // Staff (admin/moderator) must stay reachable for safety tooling.
    const targetRole = await userRoleOf(ctx.db, args.targetUserId);
    if (targetRole === "admin" || targetRole === "moderator") {
      return { ok: false as const, error: "cannot_block_staff" as const };
    }

    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", c.userId).eq("blockedId", args.targetUserId))
      .unique();
    if (existing) return { ok: false as const, error: "already_blocked" as const };

    await ctx.db.insert("blocks", {
      blockerId: c.userId as never,
      blockedId: args.targetUserId as never,
      reason: args.reason?.slice(0, 200),
      createdAt: now,
    });
    await audit(ctx.db, c.userId, c.role, "block", "user_blocked");
    return { ok: true as const };
  },
});

export const unblockUser = mutationGeneric({
  args: { sessionToken: v.string(), targetUserId: v.string() },
  handler: async (ctx, args) => {
    const c = await callerWithPrivacy(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };

    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", c.userId).eq("blockedId", args.targetUserId))
      .unique();
    if (!existing) return { ok: false as const, error: "not_blocked" as const };

    await ctx.db.delete(existing._id);
    await audit(ctx.db, c.userId, c.role, "block", "user_unblocked");
    return { ok: true as const };
  },
});

/* --------------------------- account deletion --------------------------- */

export const requestAccountDeletion = mutationGeneric({
  args: {
    sessionToken: v.string(),
    confirmText: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await callerWithPrivacy(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthorized" as const };
    if (args.confirmText.trim().toUpperCase() !== "DELETE") {
      return { ok: false as const, error: "confirm_required" as const };
    }

    // Real, immediate erasure request: the account can never sign in again
    // (every session is revoked; status flips to deleted — fail-closed).
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_user_time", (q: any) => q.eq("userId", c.userId))
      .collect();
    for (const s of sessions) {
      if (!s.revokedAt) await ctx.db.patch(s._id, { revokedAt: now });
    }
    await ctx.db.patch(c.userId as never, { status: "deleted", updatedAt: now });

    await ctx.db.insert("auditLogs", {
      actorUserId: c.userId as never,
      actorRole: c.role as never,
      eventType: "account_deletion",
      targetType: "user",
      targetId: c.userId,
      summary: args.reason ? "deletion_requested_with_reason" : "deletion_requested",
      createdAt: now,
    });
    return { ok: true as const };
  },
});
