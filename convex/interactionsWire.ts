/**
 * DENSEN — Interaction wire functions (Day 6).
 * ============================================
 * Thin mutation wrappers composing the pure core in `convex/interactions.ts`
 * with real reads/writes. Identity comes from the session token (same
 * fail-closed pattern as `convex/content.ts`); every decision, counter,
 * XP grant, notification, and audit entry happens transactionally.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import { notifyUser } from "./notifyInternals";
import {
  decideCommentQuickReaction,
  decideInteraction,
  interactionRowKind,
  interactionCountDelta,
  QUICK_REACTIONS,
  DENSEN_ACTIONS,
} from "./interactions";

/* ---------------- shared helpers ---------------- */

async function requireCaller(db: any, sessionToken: string) {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const user = await db.get(caller.userId);
  if (!user) return null;
  return { caller, user };
}

/** Either-direction block between caller and author = absolute. */
async function blockedByEither(db: any, callerId: string, authorId: string): Promise<boolean> {
  if (!authorId) return false;
  const mine = (await db
    .query("blocks")
    .withIndex("by_blocker", (q: any) => q.eq("blockerId", callerId))
    .collect()) as { blockedId: string }[];
  const theirs = (await db
    .query("blocks")
    .withIndex("by_blocked", (q: any) => q.eq("blockedId", callerId))
    .collect()) as { blockerId: string }[];
  return mine.some((b) => b.blockedId === authorId) || theirs.some((b) => b.blockerId === authorId);
}

/** Caller's recent timestamps for one interaction kind (rate-window input). */
async function recentInteractionTimes(
  db: any,
  userId: string,
  kind: string,
  windowMs: number,
  now: number
): Promise<number[]> {
  const rows = (await db
    .query("reactions")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect()) as { kind: string; createdAt: number }[];
  return rows.filter((r) => r.kind === kind && r.createdAt > now - windowMs).map((r) => r.createdAt);
}

function nowOr(argsNow?: number): number {
  return typeof argsNow === "number" && argsNow > 0 ? argsNow : Date.now();
}

/* ---------------- DENSEN interaction mutation ---------------- */

const actionUnion = v.union(...DENSEN_ACTIONS.map((a) => v.literal(a)));

export const interact = mutationGeneric({
  args: {
    sessionToken: v.string(),
    postId: v.string(),
    action: actionUnion,
    /** Only meaningful for `challenge`: the challenged dancer. */
    challengeeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = nowOr((args as { now?: number }).now);
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const post = (await ctx.db.get(args.postId as never)) as
      | { _id: string; userId: string; status: string }
      | null;

    // Interaction rows live in `reactions` with kind = action name.
    const rowKind = interactionRowKind(args.action);
    const myRows = (await ctx.db
      .query("reactions")
      .withIndex("by_user_target", (q: any) => q.eq("userId", c.caller.userId))
      .collect()) as { _id: string; targetType: string; targetId: string; kind: string; createdAt: number }[];
    const existing = myRows.find((r) => r.targetType === "post" && r.targetId === args.postId && r.kind === rowKind) ?? null;

    // BOOST: one per UTC day, from the caller's own boost history.
    let lastBoostAt: number | undefined;
    if (args.action === "boost") {
      const boosts = myRows.filter((r) => r.kind === "boost").map((r) => r.createdAt);
      lastBoostAt = boosts.length ? Math.max(...boosts) : undefined;
    }

    const recentTimes = await recentInteractionTimes(ctx.db, c.caller.userId, rowKind, 24 * 60 * 60_000, now);

    const decision = decideInteraction({
      caller: c.caller,
      action: args.action,
      target: post ? { _id: post._id as string, userId: post.userId as string, status: post.status } : null,
      blockedByEither: post ? await blockedByEither(ctx.db, c.caller.userId, post.userId as string) : false,
      recentActionTimestamps: recentTimes,
      existingRow: existing ? { _id: existing._id as string } : null,
      now,
      lastBoostAt,
    });

    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    if (decision.isToggleOff && existing) {
      await ctx.db.delete(existing._id as never);
    } else {
      await ctx.db.insert("reactions", {
        userId: c.caller.userId as never,
        targetType: "post",
        targetId: args.postId,
        kind: rowKind,
        createdAt: now,
      });
    }

    // Counters: PRACTICE and BOOST keep dedicated post counters (schema),
    // everything else is derivable from the rows table.
    const delta = interactionCountDelta(decision);
    if (delta !== 0 && post && (args.action === "practice" || args.action === "boost")) {
      const col = args.action === "practice" ? "practiceCount" : "boostCount";
      const cur = (post as unknown as Record<string, number | undefined>)[col] ?? 0;
      await ctx.db.patch(post._id as never, { [col]: Math.max(0, cur + delta), updatedAt: now });
    }

    // XP ledger — first time only (farm-safe by core decision).
    if (decision.xp.grant) {
      const balRow = (await ctx.db
        .query("creditTransactions")
        .withIndex("by_user_time", (q: any) => q.eq("userId", c.caller.userId))
        .order("desc")
        .first()) as { balanceAfter: number } | null;
      const balanceAfter = (balRow?.balanceAfter ?? 0) + decision.xp.amount;
      await ctx.db.insert("creditTransactions", {
        userId: c.caller.userId as never,
        amount: decision.xp.amount,
        balanceAfter,
        reason: "reaction",
        refType: "interaction",
        refId: args.postId,
        createdAt: now,
      });
    }

    // Notify the author (never self-notify; Day 16: the recipient's energy/
    // shares/practice/challenge category mutes are honored at write time).
    if (!decision.isToggleOff && post && post.userId !== c.caller.userId) {
      await notifyUser(ctx.db, {
        userId: post.userId as never,
        actorUserId: c.caller.userId as never,
        type: `interaction_${args.action}`,
        targetType: "post",
        targetId: args.postId,
        now,
      });
    }

    // Audit: meaningful actions only, never PII.
    if (args.action === "boost" || args.action === "challenge" || args.action === "remix" || args.action === "duet") {
      await ctx.db.insert("auditLogs", {
        actorUserId: c.caller.userId as never,
        eventType: "interaction",
        targetType: "post",
        targetId: args.postId,
        summary: `densen_${args.action}${args.action === "challenge" && args.challengeeId ? "; challengee set" : ""}`,
        createdAt: now,
      });
    }

    return {
      ok: true as const,
      active: !decision.isToggleOff,
      xpGranted: decision.xp.grant ? decision.xp.amount : 0,
    };
  },
});

/* ---------------- quick reactions on comments ---------------- */

const quickUnion = v.union(...QUICK_REACTIONS.map((r) => v.literal(r)));

export const reactToComment = mutationGeneric({
  args: {
    sessionToken: v.string(),
    commentId: v.string(),
    reaction: quickUnion,
  },
  handler: async (ctx, args) => {
    const now = nowOr((args as { now?: number }).now);
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const comment = (await ctx.db.get(args.commentId as never)) as
      | { _id: string; status: string; userId: string; postId: string }
      | null;

    const myRows = (await ctx.db
      .query("reactions")
      .withIndex("by_user_target", (q: any) => q.eq("userId", c.caller.userId))
      .collect()) as { _id: string; targetType: string; targetId: string; kind: string; createdAt: number }[];
    const existing =
      myRows.find(
        (r) => r.targetType === "comment" && r.targetId === args.commentId && r.kind === args.reaction
      ) ?? null;
    const recentTimes = myRows
      .filter((r) => r.targetType === "comment" && r.createdAt > now - 60_000)
      .map((r) => r.createdAt);

    const decision = decideCommentQuickReaction({
      caller: c.caller,
      comment: comment ? { _id: comment._id as string, status: comment.status } : null,
      reaction: args.reaction,
      existingRow: existing ? { _id: existing._id as string } : null,
      recentReactionTimestamps: recentTimes,
      now,
    });

    if (decision.action === "deny") return { ok: false as const, error: decision.error };
    if (decision.action === "delete") {
      await ctx.db.delete(decision.rowId as never);
      return { ok: true as const, active: false };
    }
    await ctx.db.insert("reactions", {
      userId: c.caller.userId as never,
      targetType: "comment",
      targetId: args.commentId,
      kind: decision.reaction,
      createdAt: now,
    });
    return { ok: true as const, active: true };
  },
});

/** Per-comment quick-reaction tally + the caller's active kinds. */
export const getCommentReactions = queryGeneric({
  args: { sessionToken: v.string(), commentId: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const rows = (await ctx.db
      .query("reactions")
      .withIndex("by_target", (q: any) => q.eq("targetType", "comment").eq("targetId", args.commentId))
      .collect()) as { kind: string; userId: string }[];
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    const mine = rows.filter((r) => r.userId === c.caller.userId).map((r) => r.kind);
    return { ok: true as const, counts, mine };
  },
});

/* ---------------- per-post DENSEN counters ---------------- */

/** Live counts + the viewer's active DENSEN interactions on one post. */
export const getPostInteractions = queryGeneric({
  args: { sessionToken: v.string(), postId: v.string() },
  handler: async (ctx, args) => {
    const rows = (await ctx.db
      .query("reactions")
      .withIndex("by_target", (q: any) => q.eq("targetType", "post").eq("targetId", args.postId))
      .collect()) as { kind: string; userId: string }[];
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    let mine: string[] = [];
    if (args.sessionToken) {
      const c = await callerFromToken(ctx.db, args.sessionToken);
      if (c) mine = rows.filter((r) => r.userId === c.userId).map((r) => r.kind);
    }
    return { ok: true as const, counts, mine };
  },
});
