/**
 * DENSEN — Profile module (wire layer).
 * ======================================
 * Owner-scoped reads and edits of the authenticated user's own profile.
 * Security model (AUTH-PLAN.md §4, enforced by convex/security.ts):
 *  - The caller's identity comes from the SESSION TOKEN (never from args).
 *  - `updateProfile` mutates ONLY the caller's own row — ownership is the
 *    session, not a client-supplied id (mass-assignment-proof by construction).
 *  - Fields pass through `validateProfileEdit` (pure core): field formats,
 *    length caps, and age-safety clamping (minors can never loosen privacy
 *    or reuse permissions).
 *  - Returns the sanitized projection only — email/DOB are unrepresentable.
 */
import { queryGeneric, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { sha256Hex } from "./authInternals";
import { sessionValid, validateProfileEdit } from "./sessionsInternals";

export const getMyProfile = queryGeneric({
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
    if (!user || user.status === "deleted" || user.status === "suspended") {
      return { ok: false as const, error: "unauthorized" };
    }
    const profile = await ctx.db
      .query("profiles")
      .withIndex("userId", (q) => q.eq("userId", session.userId))
      .unique();
    const privacy = await ctx.db
      .query("privacySettings")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .unique();

    return {
      ok: true as const,
      profile: profile
        ? {
            handle: profile.handle, // immutable (identity anchor)
            displayName: profile.displayName,
            bio: profile.bio,
            avatarUrl: projectionAvatar(profile.avatarUrl),
            styles: profile.styles,
            level: profile.level,
            city: privacy?.showCity ? profile.city : undefined, // showCity-gated
            isPrivate: profile.isPrivate,
            allowRemix: profile.allowRemix,
            allowDuet: profile.allowDuet,
            allowDownloads: profile.allowDownloads,
            followerCount: profile.followerCount,
            followingCount: profile.followingCount,
            creditBalance: profile.creditBalance,
          }
        : null,
      viewer: {
        role: user.role,
        isMinor: user.isMinor,
        ageBand: user.ageBand,
        emailVerified: user.emailVerifiedAt !== undefined,
        userStatus: user.status,
      },
      privacy: privacy
        ? {
            privateAccount: privacy.privateAccount,
            messagesFrom: privacy.messagesFrom,
            commentFilter: privacy.commentFilter,
            discoverableByHandle: privacy.discoverableByHandle,
            showCity: privacy.showCity,
            personalization: privacy.personalization,
          }
        : null,
    };
  },
});

/** Avatar URLs are never projected raw — arbitrary URL parameters are stripped. */
function projectionAvatar(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.split("?")[0];
}

export const updateProfile = mutationGeneric({
  args: {
    sessionToken: v.string(),
    patch: v.object({
      displayName: v.optional(v.string()),
      bio: v.optional(v.string()),
      city: v.optional(v.string()),
      level: v.optional(v.string()),
      styles: v.optional(v.array(v.string())),
      isPrivate: v.optional(v.boolean()),
      allowRemix: v.optional(v.boolean()),
      allowDuet: v.optional(v.boolean()),
      allowDownloads: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenHash = await sha256Hex(args.sessionToken);
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session || !sessionValid(session, now)) return { ok: false as const, error: "unauthorized" };

    const user = await ctx.db.get(session.userId);
    if (!user || user.status === "deleted" || user.status === "suspended") {
      return { ok: false as const, error: "unauthorized" };
    }
    const profile = await ctx.db
      .query("profiles")
      .withIndex("userId", (q) => q.eq("userId", session.userId))
      .unique();
    if (!profile) return { ok: false as const, error: "no_profile" };

    // Pure-core validation + age-safety clamping (minors can't loosen safety).
    const vresult = validateProfileEdit(args.patch as never, user.isMinor);
    if (!vresult.ok) return { ok: false as const, error: vresult.error };

    const cleaned = vresult.cleaned;
    const dbPatch: Record<string, unknown> = { updatedAt: now };
    if (cleaned.displayName !== undefined) dbPatch.displayName = cleaned.displayName;
    if (cleaned.bio !== undefined) dbPatch.bio = cleaned.bio;
    if (cleaned.city !== undefined) dbPatch.city = cleaned.city || undefined;
    if (cleaned.level !== undefined) dbPatch.level = cleaned.level || undefined;
    if (cleaned.styles !== undefined) dbPatch.styles = cleaned.styles;
    if (cleaned.isPrivate !== undefined) dbPatch.isPrivate = cleaned.isPrivate;
    if (cleaned.allowRemix !== undefined) dbPatch.allowRemix = cleaned.allowRemix;
    if (cleaned.allowDuet !== undefined) dbPatch.allowDuet = cleaned.allowDuet;
    if (cleaned.allowDownloads !== undefined) dbPatch.allowDownloads = cleaned.allowDownloads;

    await ctx.db.patch(profile._id, dbPatch);
    await ctx.db.insert("auditLogs", {
      actorUserId: session.userId,
      actorRole: user.role,
      eventType: "auth_event",
      targetType: "profile",
      targetId: profile._id,
      summary: "profile_updated",
      createdAt: now,
    });

    return { ok: true as const };
  },
});
