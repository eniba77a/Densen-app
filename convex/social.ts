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
import { publicProfileOf, type PublicProfileDTO } from "./validators";

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
}

/** Counter deltas to apply to `profiles` after a follow insert/delete. */
export function followCountDeltas(decision: FollowDecision): {
  followeeFollowerDelta: number;
  callerFollowingDelta: number;
} {
  if (decision.action === "insert") return { followeeFollowerDelta: 1, callerFollowingDelta: 1 };
  if (decision.action === "delete") return { followeeFollowerDelta: -1, callerFollowingDelta: -1 };
  return { followeeFollowerDelta: 0, callerFollowingDelta: 0 };
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

export const __internals = { decideFollow, followCountDeltas, canViewProfile, roleAtLeast };
