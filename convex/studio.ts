/**
 * DENSEN — Teacher Studio decision core (Day 8, pure).
 * =====================================================
 * The Studio is where verified teachers PUBLISH. Every rule here is pure and
 * unit-tested; `studioWire.ts` re-runs them server-side on every call.
 *
 * Non-negotiables (carried from Days 2–7):
 *  - Only VERIFIED teachers (or authorized admins) touch studio publishing.
 *    `teacherProfiles.status === "verified"` is the gate; pending/rejected/
 *    revoked all fail closed. Admin role comes from `users.role` — never from
 *    the client.
 *  - DRAFT → PUBLISHED → UNPUBLISHED lifecycle. Only the owner or an
 *    authorized admin may edit/transition/delete an item. No exceptions.
 *  - Day 23 — the platform is FREE: the wire layer coerces every new/updated
 *    item to priceCents 0 / creditPrice 0, so no paid content can be created
 *    anymore. Legacy price fields on old rows stay as historical data and no
 *    longer gate anything (the purchase path was removed with it).
 *  - Revenue functions below remain as payout architecture documentation;
 *    with no purchase path they can never accrue new rows.
 */
import { accessModelOf, validateClassPricing, type AccessModel } from "./learning";

/* ---------------- studio access gate ---------------- */

export interface StudioCaller {
  userId: string;
  /** From `users.role` server-side — never client-asserted. */
  role: "user" | "teacher" | "moderator" | "admin";
  userStatus: "active" | "restricted" | "suspended" | "deleted";
}

export interface TeacherProfileRow {
  status: "pending" | "verified" | "rejected" | "revoked";
  revenueSharePct?: number;
}

export type StudioAccessDecision =
  | { allowed: true; isStaff: boolean }
  | {
      allowed: false;
      error:
        | "unauthenticated"
        | "caller_restricted"
        | "not_teacher"
        | "teacher_pending"
        | "teacher_rejected"
        | "teacher_revoked";
    };

/**
 * Verified-teacher gate. Moderators do NOT get publishing rights — only
 * admins may manage content they do not own (authorized-admin rule).
 */
export function decideStudioAccess(caller: StudioCaller | null, teacher: TeacherProfileRow | null): StudioAccessDecision {
  if (!caller) return { allowed: false, error: "unauthenticated" };
  if (caller.userStatus === "suspended" || caller.userStatus === "deleted") {
    return { allowed: false, error: "caller_restricted" };
  }
  const isStaff = caller.role === "admin";
  if (isStaff && !teacher) return { allowed: true, isStaff: true };
  if (!teacher) return { allowed: false, error: "not_teacher" };
  switch (teacher.status) {
    case "verified":
      return { allowed: true, isStaff };
    case "pending":
      return { allowed: false, error: "teacher_pending" };
    case "rejected":
      return { allowed: false, error: "teacher_rejected" };
    case "revoked":
      return { allowed: false, error: "teacher_revoked" };
  }
}

/* ---------------- content kinds + lifecycle ---------------- */

/** The six studio creatables. */
export const STUDIO_KINDS = ["move", "combo", "choreography", "class", "course", "challenge"] as const;
export type StudioKind = (typeof STUDIO_KINDS)[number];

export type StudioStatus = "draft" | "published" | "unpublished";

/**
 * Lifecycle decisions. Edits and transitions are owner-or-admin only
 * (`decideStudioEdit` is enforced first); these rules assume that gate.
 */
export type TransitionDecision =
  | { ok: true; next: StudioStatus }
  | { ok: false; error: "invalid_transition" };

export function decidePublishTransition(current: StudioStatus, action: "publish" | "unpublish" | "revert_to_draft"): TransitionDecision {
  switch (action) {
    case "publish":
      // Draft and unpublished items may be (re)published; moderation can
      // still pull published items to "removed" outside this lifecycle.
      return { ok: true, next: "published" };
    case "unpublish":
      return current === "published" ? { ok: true, next: "unpublished" } : { ok: false, error: "invalid_transition" };
    case "revert_to_draft":
      return current === "unpublished" ? { ok: true, next: "draft" } : { ok: false, error: "invalid_transition" };
  }
}

export type EditDecision =
  | { ok: true }
  | { ok: false; error: "unauthenticated" | "caller_restricted" | "not_owner" };

/**
 * Only the owner or an authorized ADMIN may edit. Moderator role is
 * deliberately NOT sufficient — moderation acts through safety flows.
 */
export function decideStudioEdit(caller: StudioCaller | null, ownerId: string): EditDecision {
  if (!caller) return { ok: false, error: "unauthenticated" };
  if (caller.userStatus === "suspended" || caller.userStatus === "deleted") {
    return { ok: false, error: "caller_restricted" };
  }
  if (caller.userId !== ownerId && caller.role !== "admin") return { ok: false, error: "not_owner" };
  return { ok: true };
}

/* ---------------- item deletion (Day 23) ---------------- */

/**
 * Deleting a studio item uses the SAME ownership rule as editing: only the
 * owner or an authorized admin may delete. Reusing `decideStudioEdit` keeps
 * one tested ownership decision for every destructive write.
 */
export const decideStudioDelete = decideStudioEdit;

/* ---------------- movement steps (teacher timestamps, Day 23) ---------------- */

export interface StepInput {
  label: string;
  atSec: number;
}

export const MAX_STEPS = 40;
export const MAX_STEP_LABEL = 120;
export const MAX_STEP_SEC = 24 * 3600;

export type StepsValidation =
  | { ok: true; steps: StepInput[] }
  | { ok: false; error: "too_many_steps" | "step_label" | "step_time" };

/**
 * Validate + normalize a teacher's movement timestamps: trim labels, drop
 * empty rows, sort chronologically. Pure — the wire re-runs it on every
 * create/update so the player can trust the stored order.
 */
export function normalizeSteps(steps: StepInput[] | undefined | null): StepsValidation {
  if (!steps || steps.length === 0) return { ok: true, steps: [] };
  if (steps.length > MAX_STEPS) return { ok: false, error: "too_many_steps" };
  const out: StepInput[] = [];
  for (const s of steps) {
    const label = typeof s?.label === "string" ? s.label.trim() : "";
    if (label.length < 1 || label.length > MAX_STEP_LABEL) return { ok: false, error: "step_label" };
    const at = Number(s?.atSec);
    if (!Number.isFinite(at) || at < 0 || at > MAX_STEP_SEC) return { ok: false, error: "step_time" };
    out.push({ label, atSec: Math.round(at * 10) / 10 });
  }
  out.sort((a, b) => a.atSec - b.atSec);
  return { ok: true, steps: out };
}

/* ---------------- item validation ---------------- */

export const STYLES = [
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

export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export type StudioDifficulty = (typeof DIFFICULTIES)[number];

export const VISIBILITIES = ["public", "followers", "private"] as const;
export type StudioVisibility = (typeof VISIBILITIES)[number];

/** Studio pricing band: free, or paid €2–€30, or credits 10–500. */
export const PAID_MIN_CENTS = 200;
export const PAID_MAX_CENTS = 3000;
export const CREDITS_MIN = 10;
export const CREDITS_MAX = 500;
export const MAX_TAGS = 12;
export const MAX_TITLE = 120;
export const MAX_DESC = 2000;

export interface StudioItemInput {
  title: string;
  description: string;
  style: string;
  difficulty: StudioDifficulty;
  durationSec: number;
  priceCents: number;
  creditPrice: number;
  tags: string[];
  visibility: StudioVisibility;
  kind: StudioKind;
  deadlineAt?: number; // challenges only
}

export type ValidationOk = { ok: true; accessModel: AccessModel };
export type ValidationError = { ok: false; error: string };

export function validateStudioItem(i: StudioItemInput): ValidationOk | ValidationError {
  const title = i.title.trim();
  if (title.length < 3 || title.length > MAX_TITLE) return { ok: false, error: "title_length" };
  if (i.description.length > MAX_DESC) return { ok: false, error: "description_length" };
  if (!(STYLES as readonly string[]).includes(i.style)) return { ok: false, error: "unknown_style" };
  if (!(DIFFICULTIES as readonly string[]).includes(i.difficulty)) return { ok: false, error: "unknown_difficulty" };
  if (!(VISIBILITIES as readonly string[]).includes(i.visibility)) return { ok: false, error: "unknown_visibility" };
  if (!Number.isFinite(i.durationSec) || i.durationSec < 5 || i.durationSec > 4 * 3600) {
    return { ok: false, error: "duration_range" };
  }
  const pricing = validateClassPricing({
    accessModel: accessModelOf({ priceCents: i.priceCents, creditPrice: i.creditPrice }),
    priceCents: i.priceCents,
    creditPrice: i.creditPrice,
  });
  if (!pricing.ok) return { ok: false, error: pricing.error };
  if (i.priceCents > 0 && (i.priceCents < PAID_MIN_CENTS || i.priceCents > PAID_MAX_CENTS)) {
    return { ok: false, error: "price_out_of_range" }; // €2–€30
  }
  if (i.creditPrice > 0 && (i.creditPrice < CREDITS_MIN || i.creditPrice > CREDITS_MAX)) {
    return { ok: false, error: "credits_out_of_range" };
  }
  if (i.tags.length > MAX_TAGS) return { ok: false, error: "too_many_tags" };
  if (i.tags.some((t) => t.length < 1 || t.length > 32)) return { ok: false, error: "tag_length" };
  if (i.kind === "challenge") {
    if (!i.deadlineAt || i.deadlineAt <= Date.now()) return { ok: false, error: "challenge_deadline" };
  } else if (i.deadlineAt !== undefined) {
    return { ok: false, error: "deadline_only_for_challenges" };
  }
  return { ok: true, accessModel: accessModelOf({ priceCents: i.priceCents, creditPrice: i.creditPrice }) };
}

/* ---------------- revenue architecture (NO fake money) ---------------- */

export const DEFAULT_REVENUE_SHARE_PCT = 70; // set per-teacher at contract time

/**
 * Split math for a future settled purchase. Pure — the wire layer writes an
 * `accruing` teacherPayouts row with these numbers when a REAL purchase
 * provider confirms money; nothing else ever creates payout rows.
 */
export function splitRevenue(amountCents: number, revenueSharePct: number): { teacherCents: number; platformCents: number } {
  const pct = Math.min(100, Math.max(0, Math.round(revenueSharePct)));
  const teacherCents = Math.floor((amountCents * pct) / 100);
  return { teacherCents, platformCents: amountCents - teacherCents };
}
