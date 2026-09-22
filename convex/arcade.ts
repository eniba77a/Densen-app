/**
 * DENSEN — Arcade decision core (Day 9).
 * ======================================
 * Pure, unit-tested rules for the dance gamification system:
 *
 *  - Levels: a named ladder (1 First Steps … 10 Dance Master) built from
 *    cumulative thresholds so it can grow by appending entries — no
 *    renumbering, no migration.
 *  - XP values: one configurable source of truth per meaningful activity.
 *    Opening/watching a video is NEVER rewarded — only the completion of
 *    lessons, combos, choreographies, challenges, real practice sessions
 *    and meaningful content creation pays.
 *  - Anti-farm: the ledger pays once per (user, reason, refId); refId-less
 *    practice is rate-capped per UTC day; XP amounts are server-decided
 *    (the client can only display them).
 *  - Streaks: UTC-day-key math over MEANINGFUL activity only. Current and
 *    best streak are dance achievements, not a financial score.
 *
 * No PII, no client-trusted state; every wire call re-runs these rules.
 */

/* ------------------------------ levels ------------------------------ */

export interface LevelDef {
  /** 1-based dance level. */
  level: number;
  name: string;
  /** Cumulative XP required to reach this level. */
  xpRequired: number;
}

/**
 * The Day 9 ladder. xpRequired is cumulative; future expansion appends
 * entries (e.g. 11 "Legend") without touching earlier ones.
 */
export const DENSEN_LEVELS: readonly LevelDef[] = [
  { level: 1, name: "First Steps", xpRequired: 0 },
  { level: 2, name: "Getting Started", xpRequired: 300 },
  { level: 3, name: "Moving", xpRequired: 800 },
  { level: 4, name: "Groove", xpRequired: 1600 },
  { level: 5, name: "Dancer", xpRequired: 2800 },
  { level: 6, name: "Rising Dancer", xpRequired: 4500 },
  { level: 7, name: "Advanced Dancer", xpRequired: 6800 },
  { level: 8, name: "Performer", xpRequired: 9800 },
  { level: 9, name: "Creator", xpRequired: 14000 },
  { level: 10, name: "Dance Master", xpRequired: 20000 },
] as const;

export interface LevelState {
  level: number;
  name: string;
  xpIntoLevel: number;
  /** Width of the current level band; undefined at the cap = open band. */
  xpForLevel: number | undefined;
  /** True when the dancer has reached the top of the (current) ladder. */
  atCap: boolean;
}

/**
 * Resolve a total XP balance to a ladder position. Accepts a custom ladder
 * (used by tests/future expansion previews); defaults to the Day 9 ladder.
 */
export function levelForXp(totalXp: number, levels: readonly LevelDef[] = DENSEN_LEVELS): LevelState {
  const xp = Math.max(0, Math.round(totalXp));
  let idx = 0;
  for (let i = 0; i < levels.length; i++) {
    if (xp >= levels[i].xpRequired) idx = i;
    else break;
  }
  const cur = levels[idx];
  const next = levels[idx + 1];
  if (!next) {
    return { level: cur.level, name: cur.name, xpIntoLevel: 0, xpForLevel: undefined, atCap: true };
  }
  return {
    level: cur.level,
    name: cur.name,
    xpIntoLevel: xp - cur.xpRequired,
    xpForLevel: next.xpRequired - cur.xpRequired,
    atCap: false,
  };
}

/* --------------------------- XP values (config) --------------------------- */

/** Meaningful activities — the only XP-paying events in DENSEN. */
export type ActivityKind =
  | "lesson_complete"
  | "combo_complete"
  | "choreography_complete"
  | "challenge_complete"
  | "practice_session"
  | "content_publish";

/**
 * Configurable XP values. Tuning these is a product decision, not a code
 * change: every grant re-reads this table server-side, so amounts apply to
 * new events immediately and historical ledger rows stay immutable.
 */
export const XP_VALUES: Readonly<Record<ActivityKind, number>> = {
  lesson_complete: 150,
  combo_complete: 80,
  choreography_complete: 200,
  challenge_complete: 250,
  practice_session: 25,
  content_publish: 60,
} as const;

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "lesson_complete",
  "combo_complete",
  "choreography_complete",
  "challenge_complete",
  "practice_session",
  "content_publish",
] as const;

/** Anti-spam: refId-less practice sessions paid per UTC day. */
export const PRACTICE_DAILY_CAP = 5;

/** Anti-spam: content_publish paid per UTC day (spam-posting pays nothing). */
export const CONTENT_DAILY_CAP = 3;

/** Streak milestone bonuses, paid once per milestone per user. */
export const STREAK_BONUSES: ReadonlyArray<{ days: number; xp: number }> = [
  { days: 3, xp: 50 },
  { days: 7, xp: 150 },
  { days: 30, xp: 600 },
] as const;

/* ------------------------------ day keys ------------------------------ */

/** UTC day key ("YYYY-MM-DD") — the streak's unit of time. */
export function dayKeyFromTs(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** The UTC day key strictly before `key`. */
export function prevDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* --------------------------- activity decision --------------------------- */

export interface ActivityDecisionInput {
  caller: { userId: string; userStatus: string } | null;
  kind: ActivityKind;
  /** Stable reference for idempotency (lesson/post/challenge id). */
  refId?: string;
  /** Whether a ledger row (userId, reason, refId) already exists. */
  alreadyPaid: boolean;
  /** Paid rows for this refId-less kind today (already capped server-side). */
  paidToday: number;
  now: number;
}

export type ActivityDecision =
  | { action: "grant"; xp: number }
  | { action: "deny"; error: "unauthenticated" | "caller_restricted" | "unknown_kind" | "already_paid" | "daily_cap" };

/**
 * Decide an XP grant for a meaningful activity. Pure — the wire layer feeds
 * it ledger facts (alreadyPaid, paidToday) and persists the result.
 */
export function decideActivityXp(input: ActivityDecisionInput): ActivityDecision {
  const caller = input.caller;
  if (!caller || !caller.userId) return { action: "deny", error: "unauthenticated" };
  if (caller.userStatus === "suspended" || caller.userStatus === "deleted") {
    return { action: "deny", error: "caller_restricted" };
  }
  if (!(ACTIVITY_KINDS as readonly string[]).includes(input.kind)) {
    return { action: "deny", error: "unknown_kind" };
  }
  if (input.refId && input.alreadyPaid) return { action: "deny", error: "already_paid" };
  const cap = input.kind === "practice_session" ? PRACTICE_DAILY_CAP : input.kind === "content_publish" ? CONTENT_DAILY_CAP : Infinity;
  if (!input.refId && input.paidToday >= cap) return { action: "deny", error: "daily_cap" };
  return { action: "grant", xp: XP_VALUES[input.kind] };
}

/* ------------------------------- streaks ------------------------------- */

export interface StreakState {
  current: number;
  best: number;
  /** UTC day key of the last meaningful activity (undefined = never). */
  lastDayKey?: string;
}

export type StreakDecision =
  | { action: "touch"; next: StreakState; milestoneXp: number }
  | { action: "deny"; error: "invalid_day_key" };

/**
 * Fold one meaningful-activity day into the streak. Idempotent within a
 * day (same day → no change, no double milestone); consecutive UTC days
 * extend; a gap resets to 1. Milestone XP pays only when the NEW current
 * length hits a milestone never reached before (best guards that).
 */
export function foldActivityDay(state: StreakState, dayKey: string, now = 0): StreakDecision {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return { action: "deny", error: "invalid_day_key" };
  let current: number;
  if (state.lastDayKey === dayKey) {
    current = Math.max(1, state.current);
  } else if (state.lastDayKey === prevDayKey(dayKey)) {
    current = state.current + 1;
  } else {
    current = 1;
  }
  const best = Math.max(state.best ?? 0, current);
  const milestoneXp =
    state.lastDayKey === dayKey || current <= (state.best ?? 0)
      ? 0
      : STREAK_BONUSES.filter((m) => m.days === current).reduce((s, m) => s + m.xp, 0);
  void now;
  return { action: "touch", next: { current, best, lastDayKey: dayKey }, milestoneXp };
}
