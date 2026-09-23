/**
 * DENSEN — Achievements decision core (Day 11).
 * =============================================
 * The achievement catalog (FIRST STEP, 7 DAY DANCER, ON BEAT, COMBO MACHINE,
 * CREATOR, CHOREOGRAPHER, CONSISTENT…) lives here as pure data + pure
 * evaluation. The server auto-awards achievements inside the same
 * transactions that produce the qualifying activity (completions, streak
 * folds, publishes) — no manual claim, no reward for opening a video.
 *
 * Anti-abuse:
 *   - Awards are decided from **ledger-derived server stats**, never client
 *     claims (no client-reachable award endpoint exists);
 *   - one `userAchievements` row per (user, achievement) — the uniqueness
 *     probe (`decideAward`'s alreadyOwned flag) makes duplicate awards
 *     structurally impossible;
 *   - the XP/credit reward pays through the Day 9/10 ledger helpers with
 *     `achievement:<code>` as the refId — replay-proof like every grant.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------------- stat snapshot ---------------- */

/**
 * Everything an achievement can be measured against. All fields come from
 * server-owned tables (xp ledger, streaks, challenge participants) — the
 * client never contributes to this snapshot.
 */
export interface ActivityStats {
  lessons: number;
  combos: number;
  choreographies: number;
  challenges: number; // challenge completions (paid ledger rows)
  posts: number; // published posts
  streakBest: number;
  level: number;
}

export const ZERO_STATS: ActivityStats = {
  lessons: 0,
  combos: 0,
  choreographies: 0,
  challenges: 0,
  posts: 0,
  streakBest: 0,
  level: 1,
};

/* ---------------- catalog ---------------- */

export type StatField = keyof ActivityStats;

/** One catalog entry. `code` is stable and unique-by-convention. */
export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  xpReward: number;
  /** Human-readable rule mirrored into the `achievements.criteria` column. */
  criteria: string;
  /** The stat field that must reach `threshold`. */
  stat: StatField;
  threshold: number;
}

/**
 * The DENSEN achievement catalog. Append-only by design: new achievements
 * may be added, existing codes are permanent (ledger refs stay valid).
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    code: "first_step",
    title: "First Step",
    description: "Complete your first lesson.",
    xpReward: 25,
    criteria: "lessons >= 1",
    stat: "lessons",
    threshold: 1,
  },
  {
    code: "seven_day_dancer",
    title: "7 Day Dancer",
    description: "Keep a 7-day practice streak.",
    xpReward: 100,
    criteria: "streakBest >= 7",
    stat: "streakBest",
    threshold: 7,
  },
  {
    code: "on_beat",
    title: "On Beat",
    description: "Practice to the beat on 5 different days — reach a 5-day streak.",
    xpReward: 50,
    criteria: "streakBest >= 5",
    stat: "streakBest",
    threshold: 5,
  },
  {
    code: "combo_machine",
    title: "Combo Machine",
    description: "Complete 10 combos.",
    xpReward: 120,
    criteria: "combos >= 10",
    stat: "combos",
    threshold: 10,
  },
  {
    code: "creator",
    title: "Creator",
    description: "Publish 5 dance videos.",
    xpReward: 80,
    criteria: "posts >= 5",
    stat: "posts",
    threshold: 5,
  },
  {
    code: "choreographer",
    title: "Choreographer",
    description: "Complete 3 full choreographies.",
    xpReward: 150,
    criteria: "choreographies >= 3",
    stat: "choreographies",
    threshold: 3,
  },
  {
    code: "consistent",
    title: "Consistent",
    description: "Hold a 30-day practice streak.",
    xpReward: 400,
    criteria: "streakBest >= 30",
    stat: "streakBest",
    threshold: 30,
  },
  {
    code: "challenger",
    title: "Challenger",
    description: "Complete your first DENSEN challenge.",
    xpReward: 60,
    criteria: "challenges >= 1",
    stat: "challenges",
    threshold: 1,
  },
  {
    code: "rising_dancer",
    title: "Rising Dancer",
    description: "Reach level 5 on the DENSEN ladder.",
    xpReward: 200,
    criteria: "level >= 5",
    stat: "level",
    threshold: 5,
  },
] as const;

export function achievementByCode(code: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.code === code);
}

/* ---------------- evaluation (pure) ---------------- */

/** Progress percent (0-100) toward one achievement. */
export function progressPct(def: AchievementDef, stats: ActivityStats): number {
  const have = stats[def.stat];
  const pct = def.threshold <= 0 ? 100 : Math.floor((have / def.threshold) * 100);
  return Math.max(0, Math.min(100, pct));
}

export type AwardDecision =
  | { action: "award"; xp: number }
  | { action: "deny"; error: "already_owned" | "requirements_not_met" | "unknown_code" };

export interface AwardInput {
  def?: AchievementDef;
  stats: ActivityStats;
  /** Probe: the (user, achievement) row already exists (any progress state). */
  alreadyOwned: boolean;
}

/**
 * Award rules: requirements checked from server stats, and the ownership
 * probe wins over everything — an owned achievement can never re-award.
 */
export function decideAward(input: AwardInput): AwardDecision {
  const def = input.def;
  if (!def) return { action: "deny", error: "unknown_code" };
  if (input.alreadyOwned) return { action: "deny", error: "already_owned" };
  if (input.stats[def.stat] < def.threshold) return { action: "deny", error: "requirements_not_met" };
  return { action: "award", xp: def.xpReward };
}

/** All catalog achievements the stats currently qualify for. */
export function qualifying(defs: readonly AchievementDef[], stats: ActivityStats): AchievementDef[] {
  return defs.filter((d) => stats[d.stat] >= d.threshold);
}
