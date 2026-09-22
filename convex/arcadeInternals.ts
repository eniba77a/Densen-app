/**
 * DENSEN — Arcade internals (Day 9).
 * ==================================
 * Ledger + streak persistence shared by every surface that records a
 * meaningful dance activity (learning completions, content publishing,
 * challenge completions). Kept dependency-light (only ./arcade) so learning
 * and content modules can import it without import cycles.
 */
import { dayKeyFromTs, decideActivityXp, foldActivityDay, type ActivityKind, type StreakState } from "./arcade";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** First paid row for (user, reason, refId) — the idempotency probe. */
export async function findPaidRef(db: any, userId: string, reason: string, refId: string) {
  const rows = (await db
    .query("xpTransactions")
    .withIndex("by_reason", (q: any) => q.eq("reason", reason))
    .take(500)) as any[];
  return rows.find((r) => r.userId === userId && r.refId === refId) ?? null;
}

/** Paid refId-less rows of `reason` since UTC midnight (cap accounting). */
export async function countPaidToday(db: any, userId: string, reason: string, todayKey: string) {
  const rows = (await db
    .query("xpTransactions")
    .withIndex("by_reason", (q: any) => q.eq("reason", reason))
    .take(500)) as any[];
  return rows.filter(
    (r) =>
      r.userId === userId &&
      !r.refId &&
      typeof r.createdAt === "number" &&
      dayKeyFromTs(r.createdAt) === todayKey
  ).length;
}

/** The user's streak row (undefined when never active). Backed by the `streaks` table. */
export async function streakOf(db: any, userId: string): Promise<StreakState | undefined> {
  const row = (await db
    .query("streaks")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as any;
  if (!row) return undefined;
  return { current: row.currentLength, best: row.bestLength, lastDayKey: row.lastActivityDay };
}

/** Persist a streak fold (single row per user, patched in place). */
async function saveStreak(db: any, userId: string, next: StreakState, now: number) {
  const row = (await db
    .query("streaks")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as any;
  if (row) {
    await db.patch(row._id, {
      currentLength: next.current,
      bestLength: next.best,
      lastActivityDay: next.lastDayKey ?? row.lastActivityDay,
      updatedAt: now,
    } as never);
  } else {
    await db.insert("streaks", {
      userId: userId as never,
      currentLength: next.current,
      bestLength: next.best,
      lastActivityDay: next.lastDayKey ?? dayKeyFromTs(now),
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Fold today's meaningful activity into the user's streak and pay any NEW
 * milestone bonus (ledger row included). Returns the milestone XP granted
 * (0 on ordinary days). Called by learning/content mutations so lesson,
 * combo, choreography, challenge and publish flows all feed the streak
 * without double-paying their own XP.
 */
export async function foldStreakForActivity(db: any, userId: string, now: number): Promise<number> {
  const todayKey = dayKeyFromTs(now);
  const streak = (await streakOf(db, userId)) ?? { current: 0, best: 0 };
  const fold = foldActivityDay(streak, todayKey, now);
  if (fold.action !== "touch") return 0;
  await saveStreak(db, userId, fold.next, now);
  if (fold.milestoneXp > 0) {
    await db.insert("xpTransactions", {
      userId: userId as never,
      amount: fold.milestoneXp,
      reason: "streak_milestone",
      refType: "streak",
      refId: `day-${fold.next.current}`,
      createdAt: now,
    });
  }
  return fold.milestoneXp;
}

/**
 * Pay one activity's XP exactly once — idempotency probe by (user, reason,
 * refId) or daily cap for refId-less kinds. Returns the granted amount
 * (0 + error when denied). Used by content creation and any surface that
 * completes a meaningful activity.
 */
export async function grantActivityXp(
  db: any,
  userId: string,
  userStatus: string,
  kind: ActivityKind,
  refId: string | undefined,
  now: number
): Promise<{ granted: number; error?: string }> {
  const decision = decideActivityXp({
    caller: { userId, userStatus },
    kind,
    refId,
    alreadyPaid: refId ? Boolean(await findPaidRef(db, userId, kind, refId)) : false,
    paidToday: refId ? 0 : await countPaidToday(db, userId, kind, dayKeyFromTs(now)),
    now,
  });
  if (decision.action === "deny") return { granted: 0, error: decision.error };
  await db.insert("xpTransactions", {
    userId: userId as never,
    amount: decision.xp,
    reason: kind,
    refType: kind === "content_publish" ? "post" : kind.split("_")[0],
    refId,
    createdAt: now,
  });
  return { granted: decision.xp };
}
