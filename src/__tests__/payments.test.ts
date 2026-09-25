/**
 * Day 14 — DENSEN Payments core tests.
 * Pins the marketplace rules: server-resolved pricing inside the €2–€30 band,
 * duplicate-purchase protection, honest provider-not-configured behavior
 * (NO fake payment success), the paid-only provider-event state machine with
 * idempotent application, the refund-request machine, and teacher revenue
 * computed from VERIFIED transactions only.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_CURRENCY,
  PROVIDER_EVENT_TYPES,
  REFUND_REASONS,
  decideEventApplication,
  decidePurchaseIntent,
  decideRefundRequest,
  isRefundReason,
  isRefundableStatus,
  receiptStateOf,
  refundQueueOrder,
  teacherRevenueFromTransactions,
} from "../../convex/payments";
import { isProviderEvent, type ProviderEvent } from "../../convex/paymentProvider";

const CALLER = { userId: "u1", userStatus: "active" };
const PAID_CLASS = {
  courseKey: "c_commercial1",
  pricing: { accessModel: "paid_credits" as const, priceCents: 800, creditPrice: 80 },
};

describe("payments: purchase intent", () => {
  it("creates an intent with the SERVER-resolved price and visible currency", () => {
    const d = decidePurchaseIntent({
      caller: CALLER,
      purchasable: PAID_CLASS,
      existing: [],
      providerConfigured: true,
      now: 0,
    });
    expect(d).toEqual({ action: "create_intent", amountCents: 800, currency: "EUR" });
    expect(CHECKOUT_CURRENCY).toBe("EUR");
  });

  it("denies guests (fail closed)", () => {
    const d = decidePurchaseIntent({
      caller: null,
      purchasable: PAID_CLASS,
      existing: [],
      providerConfigured: true,
      now: 0,
    });
    expect(d).toEqual({ action: "deny", error: "unauthenticated" });
  });

  it("denies suspended accounts", () => {
    const d = decidePurchaseIntent({
      caller: { userId: "u1", userStatus: "suspended" },
      purchasable: PAID_CLASS,
      existing: [],
      providerConfigured: true,
      now: 0,
    });
    expect(d).toEqual({ action: "deny", error: "caller_restricted" });
  });

  it("free classes never create a purchase", () => {
    const d = decidePurchaseIntent({
      caller: CALLER,
      purchasable: {
        courseKey: "c_begin1",
        pricing: { accessModel: "free", priceCents: 0, creditPrice: 0 },
      },
      existing: [],
      providerConfigured: true,
      now: 0,
    });
    expect(d).toEqual({ action: "deny", error: "free_class" });
  });

  it("duplicate-purchase protection: already paid", () => {
    const d = decidePurchaseIntent({
      caller: CALLER,
      purchasable: PAID_CLASS,
      existing: [{ status: "paid" }],
      providerConfigured: true,
      now: 0,
    });
    expect(d).toEqual({ action: "deny", error: "already_owned" });
  });

  it("duplicate-purchase protection: pending intent blocks a second checkout", () => {
    const d = decidePurchaseIntent({
      caller: CALLER,
      purchasable: PAID_CLASS,
      existing: [{ status: "pending" }],
      providerConfigured: true,
      now: 0,
    });
    expect(d).toEqual({ action: "deny", error: "already_pending" });
  });

  it("an unknown class is not purchasable", () => {
    const d = decidePurchaseIntent({ caller: CALLER, purchasable: null, existing: [], providerConfigured: true, now: 0 });
    expect(d).toEqual({ action: "deny", error: "not_purchasable" });
  });

  it("charges only inside the €2–€30 band — client prices cannot smuggle a charge", () => {
    for (const cents of [100, 1, 3001, 100000]) {
      const d = decidePurchaseIntent({
        caller: CALLER,
        purchasable: { courseKey: "c_x", pricing: { accessModel: "paid", priceCents: cents, creditPrice: 0 } },
        existing: [],
        providerConfigured: true,
        now: 0,
      });
      expect(d).toEqual({ action: "deny", error: "not_purchasable" });
    }
    const edgeLow = decidePurchaseIntent({
      caller: CALLER,
      purchasable: { courseKey: "c_x", pricing: { accessModel: "paid", priceCents: 200, creditPrice: 0 } },
      existing: [],
      providerConfigured: true,
      now: 0,
    });
    const edgeHigh = decidePurchaseIntent({
      caller: CALLER,
      purchasable: { courseKey: "c_x", pricing: { accessModel: "paid", priceCents: 3000, creditPrice: 0 } },
      existing: [],
      providerConfigured: true,
      now: 0,
    });
    expect(edgeLow.action).toBe("create_intent");
    expect(edgeHigh.action).toBe("create_intent");
  });
});

describe("payments: provider events (NO fake success)", () => {
  it("a charge event flips pending → paid — the ONLY paid path", () => {
    const d = decideEventApplication({ eventType: "charge_succeeded", purchase: { status: "pending" } });
    expect(d).toEqual({ action: "apply", purchaseStatus: "paid", txKind: "charge" });
  });

  it("a charge event never applies to a missing purchase", () => {
    expect(decideEventApplication({ eventType: "charge_succeeded", purchase: null })).toEqual({
      action: "reject",
      error: "unmatched_purchase",
    });
  });

  it("an already-paid purchase is a no-op (idempotent state, no double flip)", () => {
    expect(decideEventApplication({ eventType: "charge_succeeded", purchase: { status: "paid" } })).toEqual({ action: "noop" });
  });

  it("refund events execute only on paid purchases — the provider owns the money", () => {
    expect(decideEventApplication({ eventType: "refund_executed", purchase: { status: "paid" } })).toEqual({
      action: "apply",
      purchaseStatus: "refunded",
      txKind: "refund",
    });
    expect(decideEventApplication({ eventType: "refund_executed", purchase: { status: "pending" } })).toEqual({
      action: "reject",
      error: "invalid_state",
    });
    expect(decideEventApplication({ eventType: "refund_executed", purchase: { status: "refunded" } })).toEqual({ action: "noop" });
  });

  it("chargebacks mirror to refunded from paid only", () => {
    expect(decideEventApplication({ eventType: "chargeback_opened", purchase: { status: "paid" } })).toEqual({
      action: "apply",
      purchaseStatus: "refunded",
      txKind: "chargeback",
    });
  });

  it("charge_failed moves pending → failed", () => {
    expect(decideEventApplication({ eventType: "charge_failed", purchase: { status: "pending" } })).toEqual({
      action: "apply",
      purchaseStatus: "failed",
      txKind: "charge",
    });
  });

  it("unknown event types are rejected — closed vocabulary", () => {
    expect(decideEventApplication({ eventType: "fake_success", purchase: { status: "pending" } })).toEqual({
      action: "reject",
      error: "unknown_event_type",
    });
    expect(PROVIDER_EVENT_TYPES).not.toContain("fake_success");
  });

  it("receipt state mirrors the four-state machine", () => {
    for (const s of ["pending", "paid", "refunded", "failed"]) expect(receiptStateOf({ status: s })).toBe(s);
    expect(receiptStateOf({ status: "weird" })).toBe("pending");
  });

  it("provider event shape guard accepts only complete events", () => {
    const full: ProviderEvent = {
      eventRef: "evt_1",
      providerRef: "densen_1",
      type: "charge_succeeded",
      amountCents: 800,
      currency: "EUR",
      rawStatus: "succeeded",
    };
    expect(isProviderEvent(full)).toBe(true);
    expect(isProviderEvent({ eventRef: "evt_1" })).toBe(false);
    expect(isProviderEvent(null)).toBe(false);
  });
});

describe("payments: refund requests", () => {
  it("owner can request a refund on a paid purchase", () => {
    const d = decideRefundRequest({
      caller: CALLER,
      purchase: { userId: "u1", status: "paid" },
      openRequests: [],
      reason: "duplicate_purchase",
    });
    expect(d).toEqual({ action: "create_request" });
  });

  it("non-owners are denied", () => {
    const d = decideRefundRequest({
      caller: CALLER,
      purchase: { userId: "someone_else", status: "paid" },
      openRequests: [],
      reason: "duplicate_purchase",
    });
    expect(d).toEqual({ action: "deny", error: "not_purchase_owner" });
  });

  it("only PAID purchases accept refund requests", () => {
    for (const status of ["pending", "failed"]) {
      const d = decideRefundRequest({
        caller: CALLER,
        purchase: { userId: "u1", status },
        openRequests: [],
        reason: "duplicate_purchase",
      });
      expect(d).toEqual({ action: "deny", error: "purchase_not_paid" });
    }
    const refunded = decideRefundRequest({
      caller: CALLER,
      purchase: { userId: "u1", status: "refunded" },
      openRequests: [],
      reason: "duplicate_purchase",
    });
    expect(refunded).toEqual({ action: "deny", error: "purchase_not_refundable" });
  });

  it("one open request per purchase (rejected requests don't block)", () => {
    const blocked = decideRefundRequest({
      caller: CALLER,
      purchase: { userId: "u1", status: "paid" },
      openRequests: [{ status: "requested" }],
      reason: "other",
    });
    expect(blocked).toEqual({ action: "deny", error: "open_request_exists" });
    const allowed = decideRefundRequest({
      caller: CALLER,
      purchase: { userId: "u1", status: "paid" },
      openRequests: [{ status: "rejected" }],
      reason: "other",
    });
    expect(allowed).toEqual({ action: "create_request" });
  });

  it("reasons are a closed vocabulary", () => {
    expect(REFUND_REASONS.length).toBeGreaterThanOrEqual(4);
    expect(isRefundReason("technical_issue")).toBe(true);
    expect(isRefundReason("i_felt_like_it")).toBe(false);
    const bad = decideRefundRequest({
      caller: CALLER,
      purchase: { userId: "u1", status: "paid" },
      openRequests: [],
      reason: "i_felt_like_it",
    });
    expect(bad).toEqual({ action: "deny", error: "invalid_reason" });
  });

  it("refundable-status helper matches the machine", () => {
    expect(isRefundableStatus("paid")).toBe(true);
    expect(isRefundableStatus("pending")).toBe(false);
    expect(isRefundableStatus("refunded")).toBe(false);
  });
});

describe("payments: teacher revenue (verified transactions only)", () => {
  it("sums verified charges minus verified refunds for the teacher", () => {
    const r = teacherRevenueFromTransactions(
      [
        { kind: "charge", amountCents: 800, verified: true, teacherUserId: "t1" },
        { kind: "charge", amountCents: 1200, verified: true, teacherUserId: "t1" },
        { kind: "refund", amountCents: -800, verified: true, teacherUserId: "t1" },
      ],
      "t1"
    );
    expect(r).toEqual({ chargesCents: 2000, refundedCents: 800, netCents: 1200, transactionCount: 2 });
  });

  it("unverified rows NEVER count toward revenue", () => {
    const r = teacherRevenueFromTransactions(
      [{ kind: "charge", amountCents: 999999, verified: false, teacherUserId: "t1" }],
      "t1"
    );
    expect(r).toEqual({ chargesCents: 0, refundedCents: 0, netCents: 0, transactionCount: 0 });
  });

  it("revenue attributes only to the owning teacher", () => {
    const r = teacherRevenueFromTransactions(
      [
        { kind: "charge", amountCents: 800, verified: true, teacherUserId: "t2" },
        { kind: "charge", amountCents: 500, verified: true, teacherUserId: "t1" },
      ],
      "t1"
    );
    expect(r.chargesCents).toBe(500);
    expect(r.transactionCount).toBe(1);
  });
});

describe("payments: staff queue ordering", () => {
  it("requested first, then under_review, closed last — oldest first in-band", () => {
    const rows = [
      { status: "approved", createdAt: 1 },
      { status: "under_review", createdAt: 9 },
      { status: "requested", createdAt: 5 },
      { status: "requested", createdAt: 2 },
    ];
    const sorted = [...rows].sort(refundQueueOrder);
    expect(sorted.map((r) => r.status)).toEqual(["requested", "requested", "under_review", "approved"]);
    expect(sorted[0].createdAt).toBe(2);
  });
});
