/**
 * DENSEN — Achievements internals (Day 11).
 * =========================================
 * Persistence for the achievements core: catalog seeding and the auto-award
 * evaluator. Cycle-free (imports only the pure cores and the Day 9/10
 * ledger helpers) so any completion flow can call `evaluateAchievements`
 * inside its own transaction.
 */
import { ACHIEVEMENTS, decideAward, type ActivityStats } from "./achievements";
import { levelForXp } from "./arcade";
import { earnCreditsFor } from "./creditsInternals";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Build the server stat snapshot for one user from server-owned tables. */
export async function statsFor(db: any, userId: string): Promise<ActivityStats> {
  const rows = (await db
    .query("xpTransactions")
    .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
    .collect()) as any[];

  let lessons = 0;
  let combos = 0;
  let choreographies = 0;
  let challenges = 0;
  let posts = 0;
  for (const r of rows) {
    if (r.amount <= 0) continue; // penalties/refunds never count
    if (r.reason === "lesson_complete") lessons++;
    else if (r.reason === "combo_complete") combos++;
    else if (r.reason === "choreography_complete") choreographies++;
    else if (r.reason === "challenge_complete") challenges++;
    else if (r.reason === "content_publish") posts++;
  }

  const streak = (await db
    .query("streaks")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as { bestLength: number } | null;

  // Level derives from the XP balance (Day 9 core owns the ladder).
  const balance = rows.reduce((sum, r) => sum + ((r.amount as number) || 0), 0);
  const level = levelForXp(balance).level;

  return { lessons, combos, choreographies, challenges, posts, streakBest: streak?.bestLength ?? 0, level };
}

/**
 * Auto-evaluate all achievements for one user and award any newly qualified
 * ones. Runs inside the caller's mutation (same serializable transaction).
 * Returns the codes newly unlocked here ([] normally — the flow is
 * idempotent: the ownership probe makes duplicate awards impossible).
 *
 * Called from the flows that *produce* the qualifying activity: lesson
 * completion, content publish, challenge completion, streak milestones.
 */
export async function evaluateAchievements(
  db: any,
  userId: string,
  _userStatus: string,
  stats: ActivityStats,
  now: number
): Promise<string[]> {
  const newlyUnlocked: string[] = [];

  // Ownership probe: the user's achievement rows, keyed by achievement id
  // (rows store the catalog code as the achievement reference).
  const owned = new Set(
    (
      (await db
        .query("userAchievements")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .collect()) as any[]
    ).map((r) => r.achievementId as string)
  );

  for (const def of ACHIEVEMENTS) {
    if (owned.has(def.code)) continue;
    const decision = decideAward({ def, stats, alreadyOwned: owned.has(def.code) });
    if (decision.action !== "award") continue;

    await db.insert("userAchievements", {
      userId: userId as never,
      achievementId: def.code as never, // code = stable achievement reference
      progress: 100,
      unlockedAt: now,
      createdAt: now,
    });

    // Reward: one XP ledger row (`achievement:<code>` refId — the Day 9
    // probe shape, replay-proof) + credits through the Day 10 earn path
    // (source "achievement", refId the code — one ever). Note: award XP is
    // intentionally NOT counted toward the level stat's own trigger
    // evaluation within this same pass — one snapshot, one decision.
    await db.insert("xpTransactions", {
      userId: userId as never,
      amount: def.xpReward,
      reason: "achievement_xp",
      refType: "achievement",
      refId: `achievement:${def.code}`,
      createdAt: now,
    });
    await earnCreditsFor(db, userId, "achievement", def.code, now);

    newlyUnlocked.push(def.code);
  }

  return newlyUnlocked;
}

/** Seed the achievements catalog rows (idempotent — inserts missing only). */
export async function ensureAchievementsSeed(db: any): Promise<void> {
  const existing = new Set(((await db.query("achievements").collect()) as any[]).map((r) => r.code as string));
  const now = Date.now();
  for (const def of ACHIEVEMENTS) {
    if (existing.has(def.code)) continue;
    await db.insert("achievements", {
      code: def.code,
      title: def.title,
      description: def.description,
      xpReward: def.xpReward,
      criteria: def.criteria,
      createdAt: now,
    });
  }
}

/**
 * Grant a badge (achievement code) directly — the challenge-reward path.
 * Idempotent via the ownership probe; pays a small XP bonus + credits
 * through the same ledger shapes the evaluator uses (one ever per code).
 * Returns true when the badge was newly granted.
 */
export async function awardBadge(
  db: any,
  userId: string,
  code: string,
  now: number,
  xpBonus = 50
): Promise<boolean> {
  const rows = (await db
    .query("userAchievements")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect()) as any[];
  if (rows.some((r) => r.achievementId === code)) return false;
  await db.insert("userAchievements", {
    userId: userId as never,
    achievementId: code as never,
    progress: 100,
    unlockedAt: now,
    createdAt: now,
  });
  await db.insert("xpTransactions", {
    userId: userId as never,
    amount: xpBonus,
    reason: "achievement_xp",
    refType: "achievement",
    refId: `achievement:${code}`,
    createdAt: now,
  });
  await earnCreditsFor(db, userId, "achievement", code, now);
  return true;
}
