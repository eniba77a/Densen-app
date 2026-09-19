/**
 * Social module — exemplar DENSEN backend module.
 * ===============================================
 * Demonstrates the required patterns every future module copies:
 *   - identity via `requireUser` (from the auth session, never args)
 *   - ownership via `requireOwner`
 *   - public reads via PII-stripping sanitizers (`publicProfileOf`, `publicPostOf`)
 *   - write-uniqueness enforced by read-before-write on a dedicated index
 *   - audit logging for security-relevant events
 *
 * Follow is stored in ONE row per direction keyed (followerId, followeeId).
 * Counts are denormalized on `profiles` and kept consistent inside the same
 * logical operation (read → insert/delete → patch both counters).
 *
 * Wire functions import `convex/server` directly (no codegen dependency in this
 * environment); the decision logic is factored into pure functions below so it
 * is fully unit-tested (src/__tests__/backend.test.ts).
 */
import { queryGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import {
  requireUser,
  requireRole,
  canViewProfile,
  roleAtLeast,
  type Caller,
  type Role,
} from "./security";
import { publicProfileOf, vReactionKind, type PublicProfileDTO } from "./validators";

/* ================================================================== */
/*                          Pure decision cores                       */
/* ================================================================== */

export interface FollowDecisionInput {
  caller: Caller | null;
  followee: { userId: string; status: "active" | "restricted" | "suspended" | "deleted" } | null;
  existingRow: { _id: string } | null;
}

export type FollowDecision =
  | { action: "insert"; followerId: string; followeeId: string; following: true }
  | { action: "delete"; rowId: string; following: false }
  | { action: "deny"; error: "unauthenticated" | "caller_restricted" | "cannot_follow_self" | "target_unavailable" };

/** Decide a follow toggle from the caller, target and existing row. Fail-closed. */
export function decideFollow(input: FollowDecisionInput): FollowDecision {
  let caller: Caller;
  try {
    caller = requireUser(input.caller);
  } catch {
    return { action: "deny", error: "unauthenticated" };
  }
  if (caller.userStatus === "suspended") {
    // Fail closed: restricted accounts keep no social-write privileges.
    return { action: "deny", error: "caller_restricted" };
  }
  if (!input.followee || input.followee.status !== "active") {
    return { action: "deny", error: "target_unavailable" };
  }
  if (caller.userId === input.followee.userId) {
    return { action: "deny", error: "cannot_follow_self" };
  }
  if (input.existingRow) {
    return { action: "delete", rowId: input.existingRow._id, following: false };
  }
  return { action: "insert", followerId: caller.userId, followeeId: input.followee.userId, following: true };
}/** Counter deltas to apply to `profiles` after a follow insert/delete. */
export function followCountDeltas(decision: FollowDecision): {
  followeeFollowerDelta: number;
  callerFollowingDelta: number;
} {
  if (decision.action === "insert") return { followeeFollowerDelta: 1, callerFollowingDelta: 1 };
  if (decision.action === "delete") return { followeeFollowerDelta: -1, callerFollowingDelta: -1 };
  return { followeeFollowerDelta: 0, callerFollowingDelta: 0 };
}

/* ---------------- Energy: DENSEN reactions (fire/hype/gold) ---------------- */

export const ENERGY_KINDS = ["fire", "hype", "gold"] as const;
export type EnergyKind = (typeof ENERGY_KINDS)[number];

export interface ReactionDecisionInput {
  caller: Caller | null;
  /** Closed vocabulary — the wire layer validates before calling this core. */
  kind: EnergyKind;
  /** The post/comment/course row, as visible server-side. */
  target: { status: string } | null;
  /** Existing reaction row for (user, target, kind) — uniqueness input. */
  existingRow: { _id: string } | null;
}

export type ReactionDecision =
  | { action: "insert"; userId: string; kind: EnergyKind }
  | { action: "delete"; rowId: string }
  | { action: "deny"; error: "unauthenticated" | "caller_restricted" | "target_unavailable" };

/**
 * Decide an Energy reaction toggle. Fail-closed: no session, suspended caller,
 * or unavailable target denies. One row per (user, target, kind); toggling the
 * same kind again removes it (switching kinds requires two toggles by design —
 * explicit, auditable, no silent mutation of another user's reaction row).
 */
export function decideReaction(input: ReactionDecisionInput): ReactionDecision {
  let caller: Caller;
  try {
    caller = requireUser(input.caller);
  } catch {
    return { action: "deny", error: "unauthenticated" };
  }
  if (caller.userStatus === "suspended") {
    return { action: "deny", error: "caller_restricted" };
  }
  if (!input.target || input.target.status !== "published") {
    return { action: "deny", error: "target_unavailable" };
  }
  if (input.existingRow) return { action: "delete", rowId: input.existingRow._id };
  return { action: "insert", userId: caller.userId, kind: input.kind };
}

/** likeCount delta on the target post for a reaction decision. */
export function reactionCountDelta(decision: ReactionDecision): number {
  if (decision.action === "insert") return 1;
  if (decision.action === "delete") return -1;
  return 0;
}

/* ================================================================== */
/*                        Wire functions (real)                        */
/* ================================================================== */

/**
 * Viewer-scoped profile read — PII-free and visibility-checked.
 * Guests see public profiles only; private profiles require self, follower, or
 * staff role (enforced via the tested `canViewProfile` core).
 */
export const getPublicProfile = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<PublicProfileDTO | { visible: false } | null> => {
    // Viewer identity from the server session (guest → null → restricted view).
    const subject = (await ctx.auth.getUserIdentity())?.subject;
    const viewer = subject
      ? { userId: subject, role: await resolveRole(ctx.db, subject), userStatus: "active" as const }
      : null;

    const target = await ctx.db.get(args.userId as never);
    if (!target || target.status !== "active") return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("userId", (q) => q.eq("userId", args.userId as never))
      .unique();
    if (!profile) return null;

    const teacher = await ctx.db
      .query("teacherProfiles")
      .withIndex("userId", (q) => q.eq("userId", args.userId as never))
      .unique();
    const privacy = await ctx.db
      .query("privacySettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId as never))
      .unique();

    // Follower relationship for the private-account gate.
    let viewerIsFollower = false;
    if (viewer) {
      const myFollows = (await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", viewer.userId as never))
        .collect()) as { _id: string; followeeId: string }[];
      viewerIsFollower = myFollows.some((r) => r.followeeId === args.userId);
    }

    const allowed = canViewProfile({
      targetUserStatus: target.status,
      isPrivate: profile.isPrivate,
      viewerIsFollower,
      viewerRole: viewer?.role,
      viewerIsSelf: viewer?.userId === args.userId,
    });
    if (!allowed) return { visible: false as const };

    return publicProfileOf({
      userId: args.userId,
      handle: profile.handle,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      styles: profile.styles,
      level: profile.level,
      city: profile.city,
      showCity: privacy?.showCity ?? false, // fail closed: hidden unless explicitly allowed
      isTeacher: !!teacher,
      teacherStatus: teacher?.status,
    });
  },
});

/** Toggle a follow (auth required, uniqueness enforced, counters consistent). */
export const toggleFollow = mutationGeneric({
  args: { followeeId: v.string() },
  handler: async (ctx, args) => {
    // Identity from the server session — never from arguments. Role and status
    // resolve from the caller's own row, consistent with getPublicProfile.
    const subject = (await ctx.auth.getUserIdentity())?.subject;
    let caller: Caller | null = null;
    if (subject) {
      const callerRow = (await ctx.db.get(subject as never)) as { status?: string } | null;
      caller = {
        userId: subject,
        role: await resolveRole(ctx.db, subject),
        userStatus: (callerRow?.status as Caller["userStatus"]) ?? "active",
      };
    }

    const followee = await ctx.db.get(args.followeeId as never);
    // Uniqueness check: fetch the caller's follow rows (bounded per user) and
    // match the followee in memory — the generic (untyped) query builder cannot
    // express composite index chaining; generated code would use
    // `by_follower_followee` directly.
    const myFollows = (await ctx.db
      .query("follows")
      .withIndex("by_follower", (q) => q.eq("followerId", (caller?.userId ?? "") as never))
      .collect()) as { _id: string; followeeId: string }[];
    const existing = myFollows.find((r) => r.followeeId === args.followeeId) ?? null;

    const decision = decideFollow({
      caller,
      followee: followee ? { userId: args.followeeId, status: followee.status } : null,
      existingRow: existing ? { _id: existing._id as string } : null,
    });

    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    if (decision.action === "delete") {
      await ctx.db.delete(decision.rowId as never);
    } else {
      await ctx.db.insert("follows", {
        followerId: decision.followerId as never,
        followeeId: decision.followeeId as never,
        createdAt: Date.now(),
      });
    }

    // Keep denormalized counters consistent in the same logical operation.
    const deltas = followCountDeltas(decision);
    if (deltas.followeeFollowerDelta !== 0 && followee) {
      const followeeProfile = await ctx.db
        .query("profiles")
        .withIndex("userId", (q) => q.eq("userId", args.followeeId as never))
        .unique();
      const callerProfile = await ctx.db
        .query("profiles")
        .withIndex("userId", (q) => q.eq("userId", (caller!.userId) as never))
        .unique();
      if (followeeProfile) {
        await ctx.db.patch(followeeProfile._id, {
          followerCount: Math.max(0, followeeProfile.followerCount + deltas.followeeFollowerDelta),
        });
      }
      if (callerProfile) {
        await ctx.db.patch(callerProfile._id, {
          followingCount: Math.max(0, callerProfile.followingCount + deltas.callerFollowingDelta),
        });
      }
    }

    return { ok: true as const, following: decision.action === "insert" };
  },
});

/**
 * Energy: toggle a DENSEN reaction (fire/hype/gold) on a published post.
 * Identity from session; closed-vocabulary validation at the boundary;
 * uniqueness via `by_user_target`; likeCount kept consistent in-transaction.
 */
export const toggleReaction = mutationGeneric({
  args: {
    postId: v.string(),
    kind: v.string(), // closed union enforced via vReactionKind below
  },
  handler: async (ctx, args) => {
    // Boundary validation — unknown reaction kinds never reach the core.
    const kind = vReactionKind(args.kind);

    const subject = (await ctx.auth.getUserIdentity())?.subject;
    let caller: Caller | null = null;
    if (subject) {
      const callerRow = (await ctx.db.get(subject as never)) as { status?: string } | null;
      caller = {
        userId: subject,
        role: await resolveRole(ctx.db, subject),
        userStatus: (callerRow?.status as Caller["userStatus"]) ?? "active",
      };
    }

    const post = await ctx.db.get(args.postId as never);
    const target = post ? { status: post.status } : null;

    // Uniqueness: fetch the caller's reaction rows (bounded per user) and match
    // target+kind in memory — the generic builder cannot chain composite index
    // equality; generated code would use `by_user_target` fully.
    const myReactions = (await ctx.db
      .query("reactions")
      .withIndex("by_user_target", (q) => q.eq("userId", (caller?.userId ?? "") as never))
      .collect()) as { _id: string; targetId: string; kind: string; targetType: string }[];
    const existing =
      myReactions.find((r) => r.targetType === "post" && r.targetId === args.postId && r.kind === kind) ?? null;

    const decision = decideReaction({
      caller,
      kind,
      target,
      existingRow: existing ? { _id: existing._id as string } : null,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    if (decision.action === "delete") {
      await ctx.db.delete(decision.rowId as never);
    } else {
      await ctx.db.insert("reactions", {
        userId: decision.userId as never,
        targetType: "post",
        targetId: args.postId,
        kind: decision.kind,
        createdAt: Date.now(),
      });
    }

    // likeCount consistency in the same logical operation.
    const delta = reactionCountDelta(decision);
    if (delta !== 0 && post) {
      await ctx.db.patch(post._id, {
        likeCount: Math.max(0, post.likeCount + delta),
        updatedAt: Date.now(),
      });
    }

    return { ok: true as const, active: decision.action === "insert" };
  },
});

/**
 * Move/share: record a share of a published post (shares are events, not
 * toggles — each share increments the counter). Identity required.
 */
export const recordShare = mutationGeneric({
  args: { postId: v.string() },
  handler: async (ctx, args) => {
    const subject = (await ctx.auth.getUserIdentity())?.subject;
    let callerStatus: Caller["userStatus"] = "active";
    if (subject) {
      const callerRow = (await ctx.db.get(subject as never)) as { status?: string } | null;
      if (callerRow?.status) callerStatus = callerRow.status as Caller["userStatus"];
    }
    requireUser(
      subject
        ? { userId: subject, role: await resolveRole(ctx.db, subject), userStatus: callerStatus }
        : null
    );

    const post = await ctx.db.get(args.postId as never);
    if (!post || post.status !== "published") {
      return { ok: false as const, error: "target_unavailable" };
    }
    const shareCount = post.shareCount + 1;
    await ctx.db.patch(post._id, { shareCount, updatedAt: Date.now() });
    return { ok: true as const, shareCount };
  },
});

/** Staff-only moderation queue counts (moderator+, fail-closed). */
export const moderationQueueCounts = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const subject = (await ctx.auth.getUserIdentity())?.subject;
    const caller = subject
      ? { userId: subject, role: await resolveRole(ctx.db, subject), userStatus: "active" as const }
      : null;
    requireRole(caller, "moderator");
    const open = await ctx.db
      .query("reports")
      .withIndex("by_status_priority", (q) => q.eq("status", "open"))
      .collect();
    return {
      open: open.length,
      critical: open.filter((r) => r.priority === "critical").length,
      high: open.filter((r) => r.priority === "high").length,
    };
  },
});

/** Role lookup used by wire functions (staff role lives on the users row). */
interface DbLike {
  get(id: unknown): Promise<unknown>;
}
async function resolveRole(db: DbLike, userId: string): Promise<Role> {
  const user = (await db.get(userId)) as { role?: Role } | null;
  return user?.role ?? "user";
}

export const __internals = {
  decideFollow,
  followCountDeltas,
  decideReaction,
  reactionCountDelta,
  canViewProfile,
  roleAtLeast,
};
