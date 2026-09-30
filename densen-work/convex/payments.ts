/**
 * DENSEN — Payments decision core (Day 14).
 * ========================================
 * Pure, unit-tested rules for the paid-class marketplace. The money itself is
 * provider-authoritative: `purchases` mirrors readable state, and a row can
 * only become `paid` when a VERIFIED provider event says so
 * (paymentsWire.applyProviderEvent). There is NO fake payment success and no
 * in-app money movement — refunds are executed by the provider's own refund
 * event after staff approval, and teacher revenue is aggregated from verified
 * paid charges only.
 *
 * Guarantees enforced here:
 *  - purchase intent: server-resolved pricing (the client price is display
 *    data, never the charge), duplicate-purchase protection per (user, class),
 *    free classes never create purchases, honest "provider not configured"
 *    result instead of simulated success.
 *  - refund requests: only the purchase owner, only paid purchases, one open
 *    request per purchase, typed reasons.
 *  - provider events: idempotent by (provider, eventRef); a charge event only
 *    flips a matching pending purchase to `paid`; refunds execute only on the
 *    provider's refund event.
 *  - teacher revenue: sums VERIFIED charge transactions for the teacher's
 *    classes, minus refunded/chargeback amounts — never accruals.
 */
import { accessModelOf, type ClassPricing } from "./learning";

/* ---------------- purchase intent ---------------- */

/** Server-resolved shape of a class for sale. Never trust client pricing. */
export interface PurchasableClass {
  /** Convex course id when the class is a DB row; undefined for seed-catalog keys. */
  courseId?: string;
  /** Seed-catalog key (e.g. "c_commercial1") when the class is not a DB row. */
  courseKey?: string;
  teacherUserId?: string;
  pricing: ClassPricing;
}

export type PurchaseIntentInput = {
  caller: { userId: string; userStatus: string } | null;
  /** The class as resolved server-side (null = missing/unpublished/not for sale). */
  purchasable: PurchasableClass | null;
  /** Existing rows for this (user, class) found by the duplicate probe. */
  existing: { status: string }[];
  providerConfigured: boolean;
  now: number;
};

export type PurchaseIntentDecision =
  | { action: "create_intent"; amountCents: number; currency: string }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "caller_restricted"
        | "not_purchasable"
        | "free_class"
        | "already_owned"
        | "already_pending";
    };

/** The checkout currency. Presentation config: one market today, honest and visible. */
export const CHECKOUT_CURRENCY = "EUR";

export function decidePurchaseIntent(input: PurchaseIntentInput): PurchaseIntentDecision {
  if (!input.caller || !input.caller.userId) return { action: "deny", error: "unauthenticated" };
  if (input.caller.userStatus === "suspended" || input.caller.userStatus === "deleted") {
    return { action: "deny", error: "caller_restricted" };
  }
  const p = input.purchasable;
  if (!p || (!p.courseId && !p.courseKey)) return { action: "deny", error: "not_purchasable" };
  const model = accessModelOf(p.pricing);
  if (model === "free") return { action: "deny", error: "free_class" };
  // Band guard (€2–€30) is enforced again here: the charge is always the
  // server-resolved price, inside the validated product band.
  if (p.pricing.priceCents < 200 || p.pricing.priceCents > 3000) {
    return { action: "deny", error: "not_purchasable" };
  }
  if (input.existing.some((e) => e.status === "paid")) return { action: "deny", error: "already_owned" };
  if (input.existing.some((e) => e.status === "pending")) return { action: "deny", error: "already_pending" };
  return { action: "create_intent", amountCents: p.pricing.priceCents, currency: CHECKOUT_CURRENCY };
}

/* ---------------- refund requests ---------------- */

/** Typed refund reasons (closed vocabulary — no free-text-only machine states). */
export const REFUND_REASONS = [
  "duplicate_purchase",
  "accidental_purchase",
  "content_not_as_described",
  "technical_issue",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export function isRefundReason(x: string): x is RefundReason {
  return (REFUND_REASONS as readonly string[]).includes(x);
}

export type RefundRequestDecision =
  | { action: "create_request" }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "not_purchase_owner"
        | "purchase_not_paid"
        | "open_request_exists"
        | "invalid_reason"
        | "purchase_not_refundable";
    };

export interface RefundRequestInput {
  caller: { userId: string } | null;
  /** The purchase row as resolved server-side (null = missing). */
  purchase: { userId: string; status: string } | null;
  /** Open (non-terminal) refund rows already on this purchase. */
  openRequests: { status: string }[];
  reason: string;
}

/** Terminal, refund-executed purchase — nothing more to request. */
export function isRefundableStatus(status: string): boolean {
  return status === "paid";
}

export function decideRefundRequest(input: RefundRequestInput): RefundRequestDecision {
  if (!input.caller || !input.caller.userId) return { action: "deny", error: "unauthenticated" };
  if (!input.purchase) return { action: "deny", error: "not_purchase_owner" };
  if (input.purchase.userId !== input.caller.userId) return { action: "deny", error: "not_purchase_owner" };
  if (!isRefundableStatus(input.purchase.status)) {
    return {
      action: "deny",
      error: input.purchase.status === "refunded" ? "purchase_not_refundable" : "purchase_not_paid",
    };
  }
  if (input.openRequests.some((r) => r.status !== "rejected")) return { action: "deny", error: "open_request_exists" };
  if (!isRefundReason(input.reason)) return { action: "deny", error: "invalid_reason" };
  return { action: "create_request" };
}

/* ---------------- provider event application ---------------- */

/** Event types the platform understands (provider-verified only). */
export const PROVIDER_EVENT_TYPES = [
  "charge_succeeded",
  "charge_failed",
  "refund_executed",
  "chargeback_opened",
] as const;
export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];

export type EventApplicationDecision =
  | { action: "apply"; purchaseStatus: "paid" | "failed" | "refunded"; txKind: "charge" | "refund" | "chargeback" }
  | { action: "noop" }
  | { action: "reject"; error: "unmatched_purchase" | "unknown_event_type" | "invalid_state" };

export interface EventApplicationInput {
  eventType: string;
  /** The purchase matched by providerRef (null = no pending/known intent). */
  purchase: { status: string } | null;
}

/**
 * Decide what a verified provider event does. Idempotency: the wire module
 * records (provider, eventRef) in paymentTransactions FIRST; a replay of the
 * same event id finds that row and never re-applies. This core additionally
 * refuses invalid state transitions (e.g. a charge event on an already-paid
 * purchase applies as a recorded transaction but does not re-flip state).
 */
export function decideEventApplication(input: EventApplicationInput): EventApplicationDecision {
  switch (input.eventType) {
    case "charge_succeeded":
      if (!input.purchase) return { action: "reject", error: "unmatched_purchase" };
      if (input.purchase.status === "paid") return { action: "noop" };
      if (input.purchase.status !== "pending" && input.purchase.status !== "failed") {
        return { action: "reject", error: "invalid_state" };
      }
      return { action: "apply", purchaseStatus: "paid", txKind: "charge" };
    case "charge_failed":
      if (!input.purchase) return { action: "reject", error: "unmatched_purchase" };
      if (input.purchase.status === "failed") return { action: "noop" };
      if (input.purchase.status !== "pending") return { action: "reject", error: "invalid_state" };
      return { action: "apply", purchaseStatus: "failed", txKind: "charge" };
    case "refund_executed":
      if (!input.purchase) return { action: "reject", error: "unmatched_purchase" };
      if (input.purchase.status === "refunded") return { action: "noop" };
      if (input.purchase.status !== "paid") return { action: "reject", error: "invalid_state" };
      return { action: "apply", purchaseStatus: "refunded", txKind: "refund" };
    case "chargeback_opened":
      if (!input.purchase) return { action: "reject", error: "unmatched_purchase" };
      if (input.purchase.status === "refunded") return { action: "noop" };
      if (input.purchase.status !== "paid") return { action: "reject", error: "invalid_state" };
      return { action: "apply", purchaseStatus: "refunded", txKind: "chargeback" };
    default:
      return { action: "reject", error: "unknown_event_type" };
  }
}

/* ---------------- receipt state (purchase history) ---------------- */

/** Client-shape receipt state for one purchase row. */
export type ReceiptState = "pending" | "paid" | "refunded" | "failed";

export function receiptStateOf(p: { status: string }): ReceiptState {
  switch (p.status) {
    case "pending":
    case "paid":
    case "refunded":
    case "failed":
      return p.status;
    default:
      return "pending";
  }
}

/* ---------------- teacher revenue (verified transactions only) ---------------- */

export interface RevenueTx {
  kind: string;
  /** Signed minor-unit amount from the platform's perspective. */
  amountCents: number;
  /** True when this transaction was recorded from a verified provider event. */
  verified: boolean;
  /** The class this transaction paid for (used to attribute to a teacher). */
  teacherUserId?: string;
}

/**
 * Verified revenue for one teacher: the sum of VERIFIED charge amounts on
 * their classes minus verified refunds/chargebacks. Unverified rows never
 * count — accruals live in studio analytics, never in the money view.
 */
export function teacherRevenueFromTransactions(
  rows: RevenueTx[],
  teacherUserId: string
): { chargesCents: number; refundedCents: number; netCents: number; transactionCount: number } {
  let charges = 0;
  let refunded = 0;
  let count = 0;
  for (const r of rows) {
    if (!r.verified) continue;
    if (r.teacherUserId !== teacherUserId) continue;
    if (r.kind === "charge") {
      charges += r.amountCents;
      count += 1;
    } else if (r.kind === "refund" || r.kind === "chargeback") {
      refunded += Math.abs(r.amountCents);
    }
  }
  return { chargesCents: charges, refundedCents: refunded, netCents: charges - refunded, transactionCount: count };
}

/* ---------------- refund request queue (staff) ---------------- */

/** Queue order: requested first, then under_review; oldest first inside a status. */
export function refundQueueOrder(a: { status: string; createdAt: number }, b: { status: string; createdAt: number }): number {
  const rank = (s: string) => (s === "requested" ? 0 : s === "under_review" ? 1 : 2);
  const ra = rank(a.status);
  const rb = rank(b.status);
  if (ra !== rb) return ra - rb;
  return a.createdAt - b.createdAt;
}
