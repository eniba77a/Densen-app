/**
 * DENSEN — Arcade wire layer (Day 9).
 * ===================================
 * Persists arcade decisions: every XP grant writes an immutable
 * xpTransactions row (the audit trail), streak folds write the
 * arcadeStreaks row, and the Arcade screen reads derived stats through
 * reactive queries. The client never sends XP amounts — values come from
 * convex/arcade.ts config, re-read on every call.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import { foldStreakForActivity, grantActivityXp, streakOf } from "./arcadeInternals";
import {
  ACTIVITY_KINDS,
  DENSEN_LEVELS,
  levelForXp,
  STREAK_BONUSES,
  XP_VALUES,
} from "./arcade";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Caller {
  userId: string;
  role: string;
  userStatus: string;
}

async function requireCaller(db: any, sessionToken: string): Promise<Caller | null> {
  return (await callerFromToken(db, sessionToken)) as Caller | null;
}

/** Sum of the ledger for one user. */
async function xpBalance(db: any, userId: string): Promise<number> {
  const rows = (await db
    .query("xpTransactions")
    .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
    .collect()) as any[];
  return rows.reduce((s, r) => s + (r.amount ?? 0), 0);
}


/* ------------------------------ mutations ------------------------------ */

/**
 * Record a meaningful dance activity and pay its XP. Called by the
 * learning/social surfaces when something MEANINGFUL completes; opening or
 * watching a video alone never routes here.
 */
export const recordActivity = mutationGeneric({
  args: {
    sessionToken: v.string(),
    kind: v.union(
      v.literal("lesson_complete"),
      v.literal("combo_complete"),
      v.literal("choreography_complete"),
      v.literal("challenge_complete"),
      v.literal("practice_session"),
      v.literal("content_publish")
    ),
    refId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    // The shared helper owns the idempotency probe, the daily caps, the
    // ledger row (the XP transaction record) and the value config.
    const pay = await grantActivityXp(ctx.db, c.userId, c.userStatus, args.kind, args.refId, now);
    if (pay.error) return { ok: false as const, error: pay.error as never };

    // Meaningful activity folds the streak in the same transaction.
    const milestoneXp = await foldStreakForActivity(ctx.db, c.userId, now);
    return { ok: true as const, xpGranted: pay.granted, streakMilestoneXp: milestoneXp };
  },
});

/**
 * Legacy-compatible alias used by the Lesson flow: completes route through
 * recordActivity so lesson XP and streak folding share one code path.
 */
export const recordPractice = mutationGeneric({
  args: { sessionToken: v.string(), seconds: v.number() },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    if (!Number.isFinite(args.seconds) || args.seconds < 60) {
      return { ok: false as const, error: "session_too_short" as const };
    }
    const pay = await grantActivityXp(ctx.db, c.userId, c.userStatus, "practice_session", undefined, now);
    if (pay.error) return { ok: false as const, error: pay.error as never };
    const milestoneXp = await foldStreakForActivity(ctx.db, c.userId, now);
    return { ok: true as const, xpGranted: pay.granted, streakMilestoneXp: milestoneXp };
  },
});

/* ------------------------------- queries ------------------------------- */

export interface ArcadeCounts {
  lessons: number;
  combos: number;
  choreographies: number;
  challenges: number;
  posts: number;
}

async function completionCounts(db: any, userId: string): Promise<ArcadeCounts> {
  const rows = (await db
    .query("xpTransactions")
    .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
    .collect()) as any[];
  const counts: ArcadeCounts = { lessons: 0, combos: 0, choreographies: 0, challenges: 0, posts: 0 };
  for (const r of rows) {
    if (r.amount <= 0) continue;
    if (r.reason === "lesson_complete") counts.lessons++;
    else if (r.reason === "combo_complete") counts.combos++;
    else if (r.reason === "choreography_complete") counts.choreographies++;
    else if (r.reason === "challenge_complete") counts.challenges++;
    else if (r.reason === "content_publish") counts.posts++;
  }
  return counts;
}

/** Recent ledger rows for the Arcade history list (newest first). */
async function recentXp(db: any, userId: string, limit: number) {
  const rows = (await db
    .query("xpTransactions")
    .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
    .collect()) as any[];
  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((r) => ({
      id: r._id as string,
      amount: r.amount as number,
      reason: r.reason as string,
      refType: r.refType as string | undefined,
      refId: r.refId as string | undefined,
      createdAt: r.createdAt as number,
    }));
}

/** Everything the Arcade screen renders, in one reactive subscription. */
export const getArcadeStats = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const balance = await xpBalance(ctx.db, c.userId);
    const level = levelForXp(balance);
    const streak = await streakOf(ctx.db, c.userId);
    return {
      ok: true as const,
      xp: balance,
      level: level.level,
      levelName: level.name,
      xpIntoLevel: level.xpIntoLevel,
      xpForLevel: level.xpForLevel ?? null,
      atCap: level.atCap,
      streakCurrent: streak?.current ?? 0,
      streakBest: streak?.best ?? 0,
      counts: await completionCounts(ctx.db, c.userId),
      recent: await recentXp(ctx.db, c.userId, 12),
      ladder: DENSEN_LEVELS.map((l) => ({ level: l.level, name: l.name, xpRequired: l.xpRequired })),
      xpValues: XP_VALUES,
      streakBonuses: STREAK_BONUSES,
    };
  },
});

/** Guest-safe ladder/values view (config only, no personal rows). */
export const getArcadeConfig = queryGeneric({
  args: {},
  handler: async () => ({
    ok: true as const,
    ladder: DENSEN_LEVELS.map((l) => ({ level: l.level, name: l.name, xpRequired: l.xpRequired })),
    xpValues: XP_VALUES,
    streakBonuses: STREAK_BONUSES,
    activityKinds: ACTIVITY_KINDS,
  }),
});
