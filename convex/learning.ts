/**
 * DENSEN — Learning decision core (Day 7).
 * ========================================
 * Pure, unit-tested rules for the Learn platform:
 *
 *  - Lesson progress + completion: an idempotent state machine per
 *    (user, lesson). Completing twice NEVER double-pays XP — the
 *    first-time-only ledger rule from Day 6 carries over.
 *  - Class access: FREE / PAID / CREDITS / PAID+CREDITS pricing ladder.
 *    The money itself is provider-authoritative in the future (no fake
 *    payments today); credits ARE spendable today because the ledger is
 *    real. Access is decided here, re-checked server-side on every write.
 *
 * No PII, no client-trusted state; every wire call re-runs these rules.
 */

/* ---------------- lesson progress + completion ---------------- */

export type LessonPhase = "watch" | "learn" | "practice" | "complete";

/** XP paid the FIRST time a lesson is completed. */
export const LESSON_COMPLETE_XP = 150;

export interface ProgressState {
  /** Phases the dancer has engaged with, in ascending order of progress. */
  touchedPhases: LessonPhase[];
  completedAt?: number;
}

export type CompletionDecision =
  | { action: "complete"; xpGranted: number; alreadyCompleted: false }
  | { action: "complete"; xpGranted: 0; alreadyCompleted: true }
  | { action: "deny"; error: "unauthenticated" | "caller_restricted" | "lesson_unavailable" };

/**
 * Decide a lesson completion. Idempotent: the second call for the same
 * (user, lesson) returns alreadyCompleted and grants zero XP — the farm
 * loop (complete → uncomplete → complete) cannot exist because there is
 * no uncomplete.
 */
export function decideCompletion(input: {
  caller: { userId: string; userStatus: string } | null;
  /** The lesson row as visible server-side (null = missing/unpublished). */
  lesson: { status: string; xpReward: number } | null;
  existing: ProgressState | null;
}): CompletionDecision {
  const caller = input.caller;
  if (!caller || !caller.userId) return { action: "deny", error: "unauthenticated" };
  if (caller.userStatus === "suspended" || caller.userStatus === "deleted") {
    return { action: "deny", error: "caller_restricted" };
  }
  if (!input.lesson || input.lesson.status !== "published") {
    return { action: "deny", error: "lesson_unavailable" };
  }
  if (input.existing?.completedAt) {
    return { action: "complete", xpGranted: 0, alreadyCompleted: true };
  }
  return {
    action: "complete",
    xpGranted: input.lesson.xpReward > 0 ? input.lesson.xpReward : LESSON_COMPLETE_XP,
    alreadyCompleted: false,
  };
}

/**
 * Course completion percentage from the server's own progress rows.
 * pure: given per-lesson progress and the course's published lesson
 * positions, returns 0..100.
 */
export function courseProgressPct(
  lessons: readonly { position: number }[],
  progress: readonly { position: number; completedAt?: number }[]
): number {
  if (lessons.length === 0) return 0;
  const donePositions = new Set(progress.filter((p) => p.completedAt).map((p) => p.position));
  const done = lessons.filter((l) => donePositions.has(l.position)).length;
  return Math.round((done / lessons.length) * 100);
}

/** True when every published lesson of the course is completed. */
export function isCourseComplete(
  lessons: readonly { position: number }[],
  progress: readonly { position: number; completedAt?: number }[]
): boolean {
  return lessons.length > 0 && courseProgressPct(lessons, progress) === 100;
}

/* ---------------- pricing ladder: FREE / PAID / CREDITS / PAID+CREDITS ---------------- */

/**
 * How a class can be unlocked. One of four architectures:
 *   free          — open to everyone (the "START DANCING — FREE" tier)
 *   paid          — money only (future provider checkout, €2–€30)
 *   credits       — Dance-Credits only (spendable today; ledger is real)
 *   paid_credits  — money OR credits, whichever the dancer prefers
 */
export type AccessModel = "free" | "paid" | "credits" | "paid_credits";

export interface ClassPricing {
  accessModel: AccessModel;
  /** Minor unit EUR. 0 for free / credits-only. Range guard below. */
  priceCents: number;
  /** Dance-Credits price. 0 for free / paid-only. */
  creditPrice: number;
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; error: "unauthenticated" | "payment_required" | "insufficient_credits" };

/** Derive the access model from the pricing row (schema allows any combo). */
export function accessModelOf(p: { priceCents: number; creditPrice: number }): AccessModel {
  if (p.priceCents <= 0 && p.creditPrice <= 0) return "free";
  if (p.priceCents > 0 && p.creditPrice > 0) return "paid_credits";
  if (p.priceCents > 0) return "paid";
  return "credits";
}

/** Class pricing must stay inside the product band (free excluded). */
export function validateClassPricing(p: ClassPricing): { ok: true } | { ok: false; error: string } {
  const model = accessModelOf(p);
  // The declared model must match what the numbers actually say — a "free"
  // row with a nonzero price is a lie, not a discount.
  if (model !== p.accessModel) return { ok: false, error: "access_model_mismatch" };
  if (model === "free") return p.priceCents === 0 && p.creditPrice === 0 ? { ok: true } : { ok: false, error: "free_must_be_zero" };
  if (p.priceCents > 0 && (p.priceCents < 200 || p.priceCents > 3000)) return { ok: false, error: "price_out_of_range" }; // €2–€30
  if (p.creditPrice < 0 || p.creditPrice > 500) return { ok: false, error: "credits_out_of_range" };
  return { ok: true };
}

/**
 * Can this dancer start this class right now? Credits are real ledger
 * money inside DENSEN, so a credits unlock is enforceable today; the PAID
 * half waits for the provider integration (payment_required until then).
 */
export function decideClassAccess(input: {
  caller: { userId: string } | null;
  pricing: ClassPricing;
  /** Server-side profile row (creditBalance lives there). */
  creditBalance: number;
  alreadyOwned: boolean;
}): AccessDecision {
  if (input.alreadyOwned) return { allowed: true };
  const model = accessModelOf(input.pricing);
  if (model === "free") return { allowed: true };
  if (!input.caller || !input.caller.userId) return { allowed: false, error: "unauthenticated" };
  if (model === "paid") return { allowed: false, error: "payment_required" };
  // credits or paid_credits: credits path is live today
  if (input.creditBalance < input.pricing.creditPrice) return { allowed: false, error: "insufficient_credits" };
  return { allowed: true };
}

/* ---------------- catalog helpers (client + server share the vocabulary) ---------------- */

/** Learn catalog categories (Day 7 full set). */
export const LEARN_CATEGORIES = [
  "Beginner",
  "Hip-Hop",
  "Commercial",
  "Contemporary",
  "Jazz",
  "Latin",
  "Kids",
  "Teens",
  "Advanced",
  "Professional",
] as const;

export type LearnCategory = (typeof LEARN_CATEGORIES)[number];

/** Content types in the Learn catalog. */
export const CONTENT_TYPES = ["move", "combo", "choreography", "class", "course", "lesson"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
