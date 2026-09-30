/**
 * DENSEN — Unique social interactions (Day 6, pure decision core).
 * ================================================================
 * DENSEN does not borrow Instagram/TikTok vocabulary. The interaction
 * system is a dancer's own language:
 *
 *   PRIMARY:   🔥 ENERGY (positive reaction to a performance)
 *              💬 TALK   (comments — existing Talk layer)
 *              💃 MOVE   (share/send dance content)
 *              🎯 PRACTICE (save into the dancer's Practice area)
 *   SECONDARY: 🔁 REMIX  (response/remix creation)
 *              👯 DUET   (side-by-side performance)
 *              ⚡ BOOST  (spotlight a post you love — limited, never buyable)
 *              🏆 CHALLENGE (challenge another dancer)
 *
 * Everything here is PURE and unit-tested; the wire mutations in
 * `convex/interactionsWire.ts` compose these decisions with real database
 * reads/writes. Fail-closed + anti-farm by construction:
 *
 *  - every action is a bounded rate (anti-spam)
 *  - XP exists ONLY on first-time actions (never on repeats/toggles) —
 *    farming XP by toggling the same target can never work
 *  - BOOST is 1 per user per day, never purchasable, never repeatable
 *  - moderation hooks: report/block checks and audit-log entries
 */
import type { Caller } from "./security";
import type { EnergyKind } from "./social";

/* ---------------- vocabulary ---------------- */

/** The 8 DENSEN interaction actions (primary + secondary). */
export const DENSEN_ACTIONS = [
  "energy",
  "talk",
  "move",
  "practice",
  "remix",
  "duet",
  "boost",
  "challenge",
] as const;
export type DensenAction = (typeof DENSEN_ACTIONS)[number];

/** Quick comment reactions (the 6 DENSEN one-tap energies). */
export const QUICK_REACTIONS = [
  "energy",
  "on_point",
  "vibe",
  "insane",
  "clean",
  "power",
] as const;
export type QuickReaction = (typeof QUICK_REACTIONS)[number];

/**
 * Emoji faces are presentation (UI layer). The core vocabulary is semantic —
 * feeds must never depend on emoji availability.
 */
export const QUICK_REACTION_EMOJI: Record<QuickReaction, string> = {
  energy: "🔥",
  on_point: "🎯",
  vibe: "🪩",
  insane: "💥",
  clean: "👏",
  power: "⚡",
};

/** Map a legacy 3-kind Energy tap onto the quick-reaction vocabulary. */
export function toQuickReaction(kind: EnergyKind): QuickReaction {
  return kind === "fire" ? "energy" : kind === "hype" ? "insane" : "clean";
}

/* ---------------- anti-spam (per-user rate windows) ---------------- */

export interface RateWindow {
  /** Max actions of one kind per user inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Generous but real: the goal is bot throttling, not punishing humans. */
export const RATE_LIMITS: Record<DensenAction, RateWindow> = {
  energy: { limit: 30, windowMs: 60_000 }, // 30/min
  talk: { limit: 10, windowMs: 60_000 },
  move: { limit: 20, windowMs: 60_000 },
  practice: { limit: 20, windowMs: 60_000 },
  remix: { limit: 5, windowMs: 60 * 60_000 }, // 5/hour
  duet: { limit: 5, windowMs: 60 * 60_000 },
  boost: { limit: 1, windowMs: 24 * 60 * 60_000 }, // 1/day (hard)
  challenge: { limit: 5, windowMs: 60 * 60_000 },
};

/** True when `recentTimestamps` already hit the rate limit for `action`. */
export function isRateLimited(
  action: DensenAction,
  recentTimestamps: readonly number[],
  now: number
): boolean {
  const { limit, windowMs } = RATE_LIMITS[action];
  const windowStart = now - windowMs;
  let count = 0;
  for (const ts of recentTimestamps) {
    if (ts > windowStart && ts <= now) count++;
  }
  return count >= limit;
}

/* ---------------- XP anti-farm economy ---------------- */

/** XP is granted ONLY the first time an interaction happens (per user+target). */
export const XP_FIRST_TIME: Record<DensenAction, number> = {
  energy: 5,
  talk: 3,
  move: 2,
  practice: 4,
  remix: 25,
  duet: 25,
  boost: 0, // spotlighting others is its own reward; never farmable
  challenge: 15,
};

export type XpDecision =
  | { grant: false }
  | { grant: true; amount: number; reason: string };

/**
 * XP decision for an interaction. `alreadyCountedForXp` = the same
 * (user, action, target) pair produced XP before (e.g. an existing Energy
 * row on this post, or a saved row for this target). Repeats and
 * toggle-offs NEVER grant XP — the farm loop does not exist.
 */
export function decideInteractionXp(input: {
  action: DensenAction;
  alreadyCountedForXp: boolean;
  isToggleOff: boolean;
}): XpDecision {
  if (input.isToggleOff) return { grant: false };
  if (input.alreadyCountedForXp) return { grant: false };
  const amount = XP_FIRST_TIME[input.action];
  if (amount <= 0) return { grant: false };
  return { grant: true, amount, reason: `interaction_${input.action}` };
}

/* ---------------- BOOST (1/day, spotlight, never bought) ---------------- */

const DAY_MS = 24 * 60 * 60_000;

/** True when the caller already used their single BOOST within `now`'s UTC day. */
export function boostUsedToday(lastBoostAt: number | undefined, now: number): boolean {
  if (lastBoostAt === undefined) return false;
  return Math.floor(lastBoostAt / DAY_MS) === Math.floor(now / DAY_MS);
}

/* ---------------- decision core ---------------- */

export interface InteractionDecisionInput {
  caller: Caller | null;
  action: DensenAction;
  /** The target post, as visible server-side (null = missing). */
  target: { _id: string; userId: string; status: string } | null;
  /** True when the caller and the target author have blocked each other. */
  blockedByEither: boolean;
  /** All of the caller's recent timestamps for this action (anti-spam window). */
  recentActionTimestamps: readonly number[];
  /** Existing interaction row for (caller, action, target) — toggles. */
  existingRow: { _id: string } | null;
  /** Server-side time; monotonic input so tests stay deterministic. */
  now: number;
  /** BOOST only: timestamp of the caller's previous boost, if any. */
  lastBoostAt?: number;
}

export type InteractionDecision =
  | {
      action: "apply";
      /** The post author, for notification + moderation hooks. */
      authorId: string;
      /** Toggle-off (row exists) vs first application. */
      isToggleOff: boolean;
      /** Attach XP ledger row with this shape (already farm-safe). */
      xp: XpDecision;
      kind?: QuickReaction;
    }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "caller_restricted"
        | "target_unavailable"
        | "blocked"
        | "rate_limited"
        | "boost_daily_limit";
    };

/**
 * Decide any DENSEN interaction. Order matters and is deliberate:
 * identity → status → blocks → rate → boost-day → toggle/xp.
 */
export function decideInteraction(input: InteractionDecisionInput): InteractionDecision {
  let caller: Caller;
  try {
    caller = requireCallerOf(input.caller);
  } catch {
    return { action: "deny", error: "unauthenticated" };
  }
  if (caller.userStatus === "suspended") {
    return { action: "deny", error: "caller_restricted" };
  }
  const target = input.target;
  if (!target || target.status !== "published") {
    return { action: "deny", error: "target_unavailable" };
  }
  if (input.blockedByEither) {
    return { action: "deny", error: "blocked" };
  }
  if (isRateLimited(input.action, input.recentActionTimestamps, input.now)) {
    return { action: "deny", error: "rate_limited" };
  }
  if (input.action === "boost" && boostUsedToday(input.lastBoostAt, input.now)) {
    return { action: "deny", error: "boost_daily_limit" };
  }
  const isToggleOff = input.existingRow !== null;
  return {
    action: "apply",
    authorId: target.userId,
    isToggleOff,
    kind: input.action === "energy" ? "energy" : undefined,
    xp: decideInteractionXp({
      action: input.action,
      alreadyCountedForXp: isToggleOff,
      isToggleOff,
    }),
  };
}

/** Bound, injectable caller guard (matches the repo's fail-closed style). */
function requireCallerOf(caller: Caller | null): Caller {
  if (!caller || !caller.userId) throw new Error("unauthenticated");
  return caller;
}

/** likeCount-style counter delta for a decision. */
export function interactionCountDelta(decision: InteractionDecision): number {
  return decision.action === "apply" ? (decision.isToggleOff ? -1 : 1) : 0;
}

/* ---------------- quick reactions on comments ---------------- */

export interface CommentQuickDecisionInput {
  caller: Caller | null;
  /** The comment row, as visible server-side (null = missing). */
  comment: { _id: string; status: string } | null;
  reaction: QuickReaction;
  /** Existing row for (caller, comment, reaction). */
  existingRow: { _id: string } | null;
  /** Caller's recent quick-reaction timestamps (anti-spam). */
  recentReactionTimestamps: readonly number[];
  now: number;
}

export type CommentQuickDecision =
  | { action: "insert"; reaction: QuickReaction }
  | { action: "delete"; rowId: string }
  | { action: "deny"; error: "unauthenticated" | "caller_restricted" | "target_unavailable" | "rate_limited" };

/**
 * One quick reaction per (user, comment, kind). Visible comments only —
 * auto-hidden and removed comments cannot gather new reactions.
 */
export function decideCommentQuickReaction(input: CommentQuickDecisionInput): CommentQuickDecision {
  let caller: Caller;
  try {
    caller = requireCallerOf(input.caller);
  } catch {
    return { action: "deny", error: "unauthenticated" };
  }
  if (caller.userStatus === "suspended") return { action: "deny", error: "caller_restricted" };
  if (!input.comment || input.comment.status !== "visible") {
    return { action: "deny", error: "target_unavailable" };
  }
  if (isRateLimited("energy", input.recentReactionTimestamps, input.now)) {
    return { action: "deny", error: "rate_limited" };
  }
  if (input.existingRow) return { action: "delete", rowId: input.existingRow._id };
  return { action: "insert", reaction: input.reaction };
}

/** Persisted shape of one interaction row (reactions table, `kind` column). */
export function interactionRowKind(action: DensenAction, kind?: QuickReaction): string {
  return action === "energy" && kind ? kind : action;
}
