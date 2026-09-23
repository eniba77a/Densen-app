/**
 * DENSEN — Practice decision core (Day 12).
 * =========================================
 * The DENSEN loop:  LEARN → PRACTICE → RECORD → COMPARE → COMPLETE → SHARE
 *
 * Pure, unit-tested rules — the wire module (`practiceWire.ts`) applies them
 * inside Convex transactions. Nothing here touches the database.
 *
 * What MY PRACTICE is: the user's personal workspace. Saving a Move / Combo /
 * Choreography / Class from anywhere in the app creates a practice item with
 * its own step list; practicing records real sessions (duration, completion,
 * optional attempt video); completing a step list pays XP + credits ONCE
 * through the Day 9/10 ledgers.
 *
 * Anti-farm (carried from Day 9/11 ledger rules, extended here):
 *   - completion pays exactly once per (user, item) — ledger probe,
 *   - re-practice after completion never re-pays (progress can't regress),
 *   - sessions pay XP only via the existing practice_session daily cap,
 *   - attempt video refs must come from the real media module (no fake
 *     uploads, no client-chosen URLs).
 *
 * AI analysis: NOT claimed. The compare layer stores references only
 * (teacher video ref + student attempt ref side-by-side); a future
 * analysis engine can attach results per session without schema churn.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------ content kinds ------------------------------ */

export type PracticeKind = "move" | "combo" | "choreography" | "class";

export const PRACTICE_KINDS: readonly PracticeKind[] = ["move", "combo", "choreography", "class"] as const;

export function isPracticeKind(x: unknown): x is PracticeKind {
  return typeof x === "string" && (PRACTICE_KINDS as readonly string[]).includes(x);
}

/* ------------------------------- step progress ------------------------------- */

export interface StepState {
  label: string;
  /** true = done, false = not yet, undefined = not applicable (skipped). */
  done: boolean | undefined;
}

export interface ItemProgress {
  /** Done / applicable steps, 0-100 rounded. */
  pct: number;
  doneCount: number;
  total: number;
}

/**
 * Progress = share of applicable steps done. Undefined (skipped) steps don't
 * count against completion — a 5-step plan with 1 skipped and 4 done is 100%.
 */
export function progressOf(steps: StepState[]): ItemProgress {
  const applicable = steps.filter((s) => s.done !== undefined);
  const done = applicable.filter((s) => s.done === true).length;
  const pct = applicable.length === 0 ? 0 : Math.round((done / applicable.length) * 100);
  return { pct, doneCount: done, total: applicable.length };
}

/** Toggle one step (by index). Completing all applicable steps auto-completes. */
export function toggleStep(steps: StepState[], index: number): StepState[] {
  if (index < 0 || index >= steps.length) return steps;
  const next = steps.slice();
  const cur = next[index];
  next[index] = { ...cur, done: cur.done === undefined ? undefined : !cur.done };
  return next;
}

/** True when every applicable step is done and at least one exists. */
export function isStepListComplete(steps: StepState[]): boolean {
  const p = progressOf(steps);
  return p.total > 0 && p.doneCount === p.total;
}

/* ------------------------------ XP for completion ------------------------------ */

/**
 * XP for completing a practice item, by kind. Mirrors the Day 9 ladder
 * semantics: a practiced-and-completed combo pays like a combo_complete,
 * a choreography like a choreography_complete, a class like a lesson.
 * Moves are the smallest unit. Configurable in one table.
 */
export const PRACTICE_COMPLETION_XP: Readonly<Record<PracticeKind, number>> = {
  move: 40,
  combo: 80,
  choreography: 200,
  class: 150,
};

/**
 * Whether this kind earns credits on completion (Day 10 sources).
 * Moves pay XP only (the smallest unit — no credit drip), matching the
 * Day 10 decision that practice sessions and publishes are XP-only.
 */
export const PRACTICE_CREDIT_SOURCE: Partial<Record<PracticeKind, "combo_complete" | "choreography_complete" | "lesson_complete">> = {
  combo: "combo_complete",
  choreography: "choreography_complete",
  class: "lesson_complete",
};

/* ------------------------------ session rules ------------------------------ */

/** Minimum meaningful practice duration (seconds) — mirrors Day 9's rule. */
export const SESSION_MIN_SECONDS = 60;
/** Hard cap for one session's stored duration (4h) — input sanitation. */
export const SESSION_MAX_SECONDS = 4 * 60 * 60;

export type SessionDecision =
  | { action: "record"; paid: boolean }
  | { action: "deny"; error: "unauthenticated" | "too_short" | "too_long" };

/**
 * Should a practice session be recorded (and should it pay)?
 * Sessions shorter than the minimum are NOT stored — practice theater is
 * what the anti-farm rules exist to prevent. Sessions pay XP only via the
 * practice_session daily cap, so "paid" simply reflects the caller's probe.
 */
export function decideSession(input: {
  signedIn: boolean;
  seconds: number;
}): SessionDecision {
  if (!input.signedIn) return { action: "deny", error: "unauthenticated" };
  if (!Number.isFinite(input.seconds) || input.seconds < SESSION_MIN_SECONDS) {
    return { action: "deny", error: "too_short" };
  }
  if (input.seconds > SESSION_MAX_SECONDS) return { action: "deny", error: "too_long" };
  return { action: "record", paid: true };
}

/* ------------------------------ completion rules ------------------------------ */

export type CompleteDecision =
  | { action: "complete"; xp: number; creditSource?: string }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "not_found"
        | "not_own"
        | "not_joined"
        | "steps_incomplete"
        | "already_completed";
    };

export interface CompleteInput {
  signedIn: boolean;
  /** The practice item row (undefined = missing). */
  item?: {
    userId: string;
    completedAt?: number;
  } | null;
  callerUserId: string;
  /** Ledger probe: a paid practice_complete row for this item already exists. */
  alreadyPaid: boolean;
  /** Current step states of the item. */
  steps: StepState[];
  /** Which kind of content this is (drives the XP/credit ladder). */
  kind: PracticeKind;
}

/**
 * Completion rules:
 *   - the item must exist and belong to the caller,
 *   - every applicable step must be done (the loop is real),
 *   - the ledger probe wins: one completion ever, per (user, item).
 * Re-completing after completion is denied, not silently re-paid.
 */
export function decideComplete(input: CompleteInput): CompleteDecision {
  if (!input.signedIn) return { action: "deny", error: "unauthenticated" };
  const item = input.item;
  if (!item) return { action: "deny", error: "not_found" };
  if (item.userId !== input.callerUserId) return { action: "deny", error: "not_own" };
  if (input.alreadyPaid || item.completedAt) return { action: "deny", error: "already_completed" };
  if (!isStepListComplete(input.steps)) return { action: "deny", error: "steps_incomplete" };
  return {
    action: "complete",
    xp: PRACTICE_COMPLETION_XP[input.kind],
    creditSource: PRACTICE_CREDIT_SOURCE[input.kind],
  };
}

/* ------------------------------ default step plans ------------------------------ */

/**
 * Default step plans per kind — MY PRACTICE generates a concrete plan when
 * an item is saved so the user always sees actionable steps. Studio-authored
 * content passes its own steps; these are the fallbacks.
 */
export const DEFAULT_STEPS: Readonly<Record<PracticeKind, readonly string[]>> = {
  move: ["Learn the basic shape", "Slow it down to 50%", "Drill it to the beat", "Perform it full-out"],
  combo: [
    "Break down each move",
    "Connect moves 1–2",
    "Connect the full chain",
    "Add musicality",
    "Full-out to a song",
  ],
  choreography: [
    "Learn section 1",
    "Learn section 2",
    "Learn section 3",
    "Connect all sections",
    "Full run with performance energy",
  ],
  class: ["Watch the class", "Practice along", "Drill the hardest part", "Complete the class"],
} as const;

export function stepsFromPlan(labels: readonly string[]): StepState[] {
  return labels.map((label) => ({ label, done: false }));
}

/* ------------------------------ compare layer ------------------------------ */

/**
 * The side-by-side comparison architecture: a session can carry a teacher
 * video ref and a student attempt ref. DENSEN stores REFERENCES only and
 * renders them side-by-side — no AI movement analysis is claimed today.
 * The optional `analysis` slot is where a future engine (pose tracking,
 * timing comparison) would attach results; it stays empty by design.
 */
export interface ComparePair {
  /** Teacher/reference video ref (from the content or the media module). */
  teacherRef?: string;
  /** The student's own attempt video ref (media module). */
  studentRef?: string;
  /**
   * Reserved for a future AI analysis engine. Always undefined today —
   * DENSEN does not claim movement analysis it does not perform.
   */
  analysis?: never;
}

/** Validate refs client-independently: refs are opaque, non-empty, capped. */
export function sanitizeRef(ref: unknown): string | undefined {
  if (typeof ref !== "string") return undefined;
  const t = ref.trim();
  if (t.length === 0 || t.length > 256) return undefined;
  return t;
}

/* ------------------------------ projection ------------------------------ */

/** Client-facing practice item view. */
export interface PracticeItemView {
  id: string;
  kind: PracticeKind;
  title: string;
  subtitle?: string;
  style?: string;
  difficulty?: string;
  /** Catalog reference (seed course key or Convex class/course id). */
  contentRef: string;
  /** Deep link back to the content (e.g. /course/:id or /lesson/:course/:lesson). */
  href?: string;
  steps: StepState[];
  progress: ItemProgress;
  completedAt?: number;
  sessionCount: number;
  lastPracticedAt?: number;
  totalSeconds: number;
  bestAttemptRef?: string;
  createdAt: number;
}

/** Sort for MY PRACTICE: in-progress first (by recency), then completed. */
export function sortForDisplay(items: PracticeItemView[]): PracticeItemView[] {
  return items.slice().sort((a, b) => {
    const ac = a.completedAt ? 1 : 0;
    const bc = b.completedAt ? 1 : 0;
    if (ac !== bc) return ac - bc; // incomplete first
    const al = a.lastPracticedAt ?? a.createdAt;
    const bl = b.lastPracticedAt ?? b.createdAt;
    return bl - al;
  });
}

/** Aggregate MY PRACTICE header stats. */
export function summarize(items: PracticeItemView[]): {
  total: number;
  active: number;
  completed: number;
  totalSeconds: number;
  avgProgressPct: number;
} {
  const total = items.length;
  const completed = items.filter((i) => i.completedAt).length;
  const totalSeconds = items.reduce((s, i) => s + i.totalSeconds, 0);
  const avgProgressPct =
    total === 0 ? 0 : Math.round(items.reduce((s, i) => s + i.progress.pct, 0) / total);
  return { total, active: total - completed, completed, totalSeconds, avgProgressPct };
}
