/**
 * DENSEN LEARN — client catalog layer (Day 7).
 * ============================================
 * Day 7 requirements live here: the full category set, the six content
 * types, the FREE/PAID/CREDITS/PAID+CREDITS pricing architecture and the
 * "START DANCING — FREE" beginner track.
 *
 * Pricing mirrors the server core (`convex/learning.ts` accessModelOf) —
 * the two sides share the same ladder so a client display can never
 * disagree with a server decision. Money itself is NOT implemented
 * (no fake payments): PAID surfaces an honest "checkout coming soon"
 * state, while CREDITS are real because the Dance-Credits ledger is real.
 */
import type { Course } from "./store";

/** Full Day 7 category set (server mirror: LEARN_CATEGORIES). */
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

/** Content types in the catalog (server mirror: CONTENT_TYPES). */
export const CONTENT_TYPES = ["move", "combo", "choreography", "class", "course", "lesson"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Pricing architecture: FREE / PAID / CREDITS / PAID+CREDITS. */
export type AccessModel = "free" | "paid" | "credits" | "paid_credits";

export interface ClassPricing {
  accessModel: AccessModel;
  /** Minor unit EUR; paid classes band €2–€30 (validated server-side too). */
  priceCents: number;
  /** Dance-Credits price (real ledger currency). */
  creditPrice: number;
}

/** Mirror of the server's accessModelOf — must stay in lockstep (tested). */
export function accessModelOf(p: { priceCents: number; creditPrice: number }): AccessModel {
  if (p.priceCents <= 0 && p.creditPrice <= 0) return "free";
  if (p.priceCents > 0 && p.creditPrice > 0) return "paid_credits";
  if (p.priceCents > 0) return "paid";
  return "credits";
}

/**
 * Catalog pricing. FREE courses are simply absent; every paid class sits in
 * the €2–€30 product band. `paid_credits` = money OR credits at the
 * dancer's choice.
 */
export const CLASS_PRICING: Record<string, ClassPricing> = {
  c_commercial1: { accessModel: "paid_credits", priceCents: 800, creditPrice: 80 }, // €8 or 80 credits
  c_contemp1: { accessModel: "paid_credits", priceCents: 800, creditPrice: 80 },
  c_adv1: { accessModel: "paid", priceCents: 1200, creditPrice: 0 }, // €12 money-only
  c_jazz1: { accessModel: "credits", priceCents: 0, creditPrice: 60 }, // 60 credits only
  c_latin1: { accessModel: "paid_credits", priceCents: 200, creditPrice: 20 }, // €2 — cheapest band
  c_hiphop1: { accessModel: "free", priceCents: 0, creditPrice: 0 },
  c_begin1: { accessModel: "free", priceCents: 0, creditPrice: 0 },
  c_kids1: { accessModel: "free", priceCents: 0, creditPrice: 0 },
};

export const pricingOf = (courseId: string): ClassPricing | undefined => CLASS_PRICING[courseId];

/**
 * START DANCING — FREE: the free beginner track. Everything here is free
 * forever, ordered as a first-day path: groove → footwork → isolation →
 * musicality → beginner combo → beginner choreography.
 */
export const FREE_TRACK_IDS = ["c_begin1", "c_hiphop1", "c_kids1"] as const;
export const isFreeTrack = (courseId: string) => (FREE_TRACK_IDS as readonly string[]).includes(courseId);

/** One row of the free first-day path (display data, backed by real courses). */
export interface FreeStep {
  id: string;
  /** i18n key for the step label. */
  labelKey: string;
  contentType: ContentType;
  /** The real catalog course this step opens. */
  courseId: string;
  minutes: number;
}

export const FREE_TRACK: FreeStep[] = [
  { id: "f1", labelKey: "learn.free.groove", contentType: "move", courseId: "c_begin1", minutes: 10 },
  { id: "f2", labelKey: "learn.free.footwork", contentType: "move", courseId: "c_begin1", minutes: 12 },
  { id: "f3", labelKey: "learn.free.isolation", contentType: "move", courseId: "c_hiphop1", minutes: 14 },
  { id: "f4", labelKey: "learn.free.musicality", contentType: "combo", courseId: "c_hiphop1", minutes: 16 },
  { id: "f5", labelKey: "learn.free.combo", contentType: "course", courseId: "c_begin1", minutes: 14 },
  { id: "f6", labelKey: "learn.free.choreo", contentType: "choreography", courseId: "c_hiphop1", minutes: 18 },
];

/** The six content types with their catalog meaning (chips, filters, badges). */
export const CONTENT_TYPE_META: Record<ContentType, { icon: string }> = {
  move: { icon: "🦶" },
  combo: { icon: "🧩" },
  choreography: { icon: "✨" },
  class: { icon: "🎓" },
  course: { icon: "📚" },
  lesson: { icon: "▶️" },
};

/** Total minutes across a course's lessons — the duration shown on class pages. */
export const courseMinutes = (c: Course) => c.lessons.reduce((s, l) => s + l.dur, 0);

/**
 * What-you-learn bullets: derived deterministically from the course's own
 * lesson titles/moves (no hand-written marketing copy to drift).
 */
export function whatYouLearn(c: Course): string[] {
  return c.lessons.slice(0, 4).map((l) => l.title);
}
