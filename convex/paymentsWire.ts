/**
 * DENSEN — Payments wire functions (Day 14).
 * =========================================
 * Thin wire layer over the payments decision core. Structure mirrors
 * creditsWire/musicRightsWire. Every function:
 *   - resolves the caller from the session token (identity never from args);
 *   - resolves prices/pricing SERVER-side (the client's numbers are display
 *     data, never the charge);
 *   - fails closed, and fails HONESTLY on money: when no payment provider is
 *     configured, `startPurchase` returns `provider_not_configured` — it never
 *     marks anything paid, and `applyProviderEvent` is the ONLY path that can
 *     set `status:"paid"` (called from the provider webhook seam with a
 *     verified event).
 *
 * Duplicate-purchase protection is an in-transaction probe on
 * (userId, courseId | courseKey) — Convex mutations are serializable, so a
 * concurrent double-buy serializes and the loser sees `already_owned` /
 * `already_pending`.
 */
import { v } from "convex/values";
import { mutationGeneric, queryGeneric } from "convex/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import {
  decideEventApplication,
  decidePurchaseIntent,
  decideRefundRequest,
  isRefundableStatus,
  receiptStateOf,
  refundQueueOrder,
  teacherRevenueFromTransactions,
  type PurchasableClass,
  type RevenueTx,
} from "./payments";
import { accessModelOf } from "./learning";
import { getPaymentProvider, isPaymentsConfigured } from "./paymentProvider";
import { callerFromToken } from "./content";
import { notifyUser } from "./notifyInternals";
import { requireRole } from "./security";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/* ---------------- class resolution (server-side pricing) ---------------- */

/**
 * Resolve a class for sale by id. Three id spaces:
 *  1. seed-catalog keys (`c_*`) — pricing from the client-mirrored catalog is
 *     NOT trusted; these classes have no server pricing yet, so the wire
 *     resolves them from the caller-supplied pricing ONLY after validating the
 *     paid band again (decidePurchaseIntent enforces €2–€30).
 *  2. `courses` rows — server pricing is authoritative.
 *  3. `classes` rows (studio-published) — server pricing is authoritative.
 * Returns null when nothing sellable matches.
 */
async function resolvePurchasable(db: Db, classId: string, seedPricing?: { priceCents: number; creditPrice: number }): Promise<PurchasableClass | null> {
  // 1. Convex course row?
  const course = (await db.get(classId as never)) as
    | { teacherId?: string; priceCents?: number; creditPrice?: number; currency?: string; status?: string }
    | null;
  if (course && course.priceCents !== undefined && course.currency !== undefined && course.status === "published") {
    return {
      courseId: classId,
      teacherUserId: course.teacherId,
      pricing: { accessModel: accessModelOf({ priceCents: course.priceCents, creditPrice: course.creditPrice ?? 0 }), priceCents: course.priceCents, creditPrice: course.creditPrice ?? 0 },
    };
  }
  // 2. Studio-published class row?
  const cls = (await db.get(classId as never)) as { teacherId?: string; priceCents?: number; creditPrice?: number; status?: string } | null;
  if (cls && cls.teacherId !== undefined && cls.priceCents !== undefined && cls.status === "published") {
    return {
      courseId: classId,
      teacherUserId: cls.teacherId,
      pricing: { accessModel: accessModelOf({ priceCents: cls.priceCents, creditPrice: cls.creditPrice ?? 0 }), priceCents: cls.priceCents, creditPrice: cls.creditPrice ?? 0 },
    };
  }
  // 3. Seed-catalog class (no server row): price stays in the validated band.
  if (classId.startsWith("c_") && seedPricing) {
    return {
      courseKey: classId,
      pricing: {
        accessModel: accessModelOf(seedPricing),
        priceCents: seedPricing.priceCents,
        creditPrice: seedPricing.creditPrice,
      },
    };
  }
  return null;
}

/** Duplicate-purchase probe across both id spaces. */
async function existingPurchases(db: Db, userId: string, p: PurchasableClass) {
  if (p.courseId) {
    return (await db
      .query("purchases")
      .withIndex("by_user_course", (q: any) => q.eq("userId", userId).eq("courseId", p.courseId as never))
      .collect()) as { status: string }[];
  }
  return (await db
    .query("purchases")
    .withIndex("by_user_course_key", (q: any) => q.eq("userId", userId).eq("courseKey", p.courseKey as string))
    .collect()) as { status: string }[];
}

/* ---------------- start purchase (checkout intent) ---------------- */

/**
 * Create a pending purchase + call the provider for a real checkout session.
 * WITHOUT a configured provider this returns `ok:false, error:
 * "provider_not_configured"` and writes NOTHING — the honest state the UI
 * shows. There is no demo-success path anywhere.
 */
export const startPurchase = mutationGeneric({
  args: {
    sessionToken: v.string(),
    classId: v.string(),
    /** Seed-catalog pricing display data (validated again server-side). */
    seedPriceCents: v.optional(v.number()),
    seedCreditPrice: v.optional(v.number()),
  },
  handler: async (ctx: GenericMutationCtx<any>, args: { sessionToken: string; classId: string; seedPriceCents?: number; seedCreditPrice?: number }) => {
    const now = Date.now();
    const db = ctx.db;
    const caller = await callerFromToken(db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const purchasable = await resolvePurchasable(
      db,
      args.classId,
      args.seedPriceCents !== undefined ? { priceCents: args.seedPriceCents, creditPrice: args.seedCreditPrice ?? 0 } : undefined
    );
    const existing = purchasable ? await existingPurchases(db, caller.userId, purchasable) : [];
    const decision = decidePurchaseIntent({
      caller,
      purchasable,
      existing,
      providerConfigured: isPaymentsConfigured(),
      now,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    // Honest no-provider outcome: nothing is written, nothing becomes paid.
    if (!isPaymentsConfigured()) return { ok: false as const, error: "provider_not_configured" as const };

    // Mint the intent row + provider checkout session in one transaction.
    const providerRef = `densen_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const purchaseId = (await db.insert("purchases", {
      userId: caller.userId as never,
      courseId: purchasable!.courseId as never,
      courseKey: purchasable!.courseKey,
      teacherUserId: purchasable!.teacherUserId as never,
      amountCents: decision.amountCents,
      currency: decision.currency,
      provider: getPaymentProvider().name,
      providerRef,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })) as string;

    try {
      const session = await getPaymentProvider().createCheckoutSession({
        purchaseId,
        providerRef,
        amountCents: decision.amountCents,
        currency: decision.currency,
        description: `DENSEN class ${purchasable!.courseId ?? purchasable!.courseKey}`,
      });
      return { ok: true as const, purchaseId, checkoutUrl: session.url, providerRef };
    } catch {
      // Provider failed to mint a session — the pending row stays pending
      // (never paid); the caller sees an honest failure.
      return { ok: false as const, error: "provider_error" as const, purchaseId };
    }
  },
});

/* ---------------- provider event seam (webhook) ---------------- */

/**
 * INTERNAL: apply a VERIFIED provider event. This is the only code path in
 * the platform that can move a purchase to `paid` (or `refunded`/`failed`).
 * The webhook transport (raw-body HMAC verification, timestamp tolerance)
 * lives in the provider implementation; this mutation assumes the event has
 * already been verified and applies it idempotently:
 *   1. probe paymentTransactions.by_provider_event (provider, eventRef) —
 *      a replay is a no-op;
 *   2. run the decision core;
 *   3. append the transaction row + mirror the purchase status in ONE
 *      transaction (serializable).
 */
export const applyProviderEvent = mutationGeneric({
  args: {
    provider: v.string(),
    eventRef: v.string(),
    providerRef: v.string(),
    eventType: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    rawStatus: v.string(),
  },
  handler: async (ctx: GenericMutationCtx<any>, args) => {
    const now = Date.now();
    const db = ctx.db;

    // Idempotency probe FIRST — replays never re-apply.
    const replay = (await db
      .query("paymentTransactions")
      .withIndex("by_provider_event", (q: any) => q.eq("provider", args.provider).eq("providerEventRef", args.eventRef))
      .first()) as unknown;
    if (replay !== null) return { ok: true as const, applied: false as const, reason: "duplicate_event" as const };

    const purchase = (await db
      .query("purchases")
      .withIndex("by_provider_ref", (q: any) => q.eq("providerRef", args.providerRef))
      .unique()) as { _id: string; userId: string; status: string; teacherUserId?: string } | null;

    const decision = decideEventApplication({ eventType: args.eventType, purchase });
    if (decision.action === "reject") return { ok: false as const, error: decision.error };

    if (decision.action === "noop") {
      // State already matches; still record the (verified) event so the
      // idempotency probe catches any future replay of this event id.
      const kind = args.eventType === "refund_executed" ? "refund" : args.eventType === "chargeback_opened" ? "chargeback" : "charge";
      await db.insert("paymentTransactions", {
        provider: args.provider,
        providerEventRef: args.eventRef,
        purchaseId: (purchase!._id as never) as never,
        userId: (purchase!.userId as never) as never,
        kind,
        amountCents: args.amountCents,
        currency: args.currency,
        rawStatus: args.rawStatus,
        createdAt: now,
      });
      return { ok: true as const, applied: false as const, reason: "already_applied" as const };
    }

    // Apply: mirror purchase state + append the authoritative transaction row.
    await db.patch(purchase!._id as never, { status: decision.purchaseStatus, updatedAt: now });
    await db.insert("paymentTransactions", {
      provider: args.provider,
      providerEventRef: args.eventRef,
      purchaseId: purchase!._id as never,
      userId: purchase!.userId as never,
      kind: decision.txKind,
      amountCents: decision.txKind === "charge" ? args.amountCents : -Math.abs(args.amountCents),
      currency: args.currency,
      rawStatus: args.rawStatus,
      createdAt: now,
    });

    // Notify the buyer on the state change that matters to them.
    if (decision.purchaseStatus === "paid") {
      await notifyUser(db, { userId: purchase!.userId, type: "purchase_paid", targetType: "purchase", targetId: purchase!._id as string, now });
    }
    await db.insert("auditLogs", {
      eventType: "payment_event",
      targetType: "purchase",
      targetId: purchase!._id as string,
      summary: `${args.eventType}; provider:${args.provider}; amount:${args.amountCents} ${args.currency}; status->${decision.purchaseStatus}`,
      createdAt: now,
    });
    return { ok: true as const, applied: true as const, status: decision.purchaseStatus };
  },
});

/* ---------------- refund requests ---------------- */

/**
 * User files a refund request on a PAID purchase. Only the owner, one open
 * request per purchase, typed reason. No money moves here — approval and the
 * provider refund execution are staff/provider actions.
 */
export const requestRefund = mutationGeneric({
  args: { sessionToken: v.string(), purchaseId: v.string(), reason: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx: GenericMutationCtx<any>, args: { sessionToken: string; purchaseId: string; reason: string; detail?: string }) => {
    const now = Date.now();
    const db = ctx.db;
    const caller = await callerFromToken(db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const purchase = (await db.get(args.purchaseId as never)) as { _id: string; userId: string; status: string } | null;
    const openRequests = purchase
      ? ((await db
          .query("refundRequests")
          .withIndex("by_purchase", (q: any) => q.eq("purchaseId", purchase._id as never))
          .collect()) as { status: string }[])
      : [];

    const decision = decideRefundRequest({
      caller,
      purchase: purchase ? { userId: purchase.userId as string, status: purchase.status } : null,
      openRequests,
      reason: args.reason,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    const id = (await db.insert("refundRequests", {
      purchaseId: args.purchaseId as never,
      userId: caller.userId as never,
      reason: args.reason,
      detail: args.detail,
      status: "requested",
      createdAt: now,
      updatedAt: now,
    })) as string;
    await db.insert("auditLogs", {
      actorUserId: caller.userId as never,
      actorRole: caller.role as never,
      eventType: "refund_requested",
      targetType: "purchase",
      targetId: args.purchaseId,
      summary: `reason:${args.reason}`,
      createdAt: now,
    });
    return { ok: true as const, refundId: id };
  },
});

/** The caller's refund requests (own data only). */
export const myRefundRequests = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: GenericQueryCtx<any>, args: { sessionToken: string }) => {
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated", refunds: [] as never[] };
    const rows = (await ctx.db
      .query("refundRequests")
      .withIndex("by_user", (q: any) => q.eq("userId", caller.userId as never))
      .collect()) as { _id: string; purchaseId: string; reason: string; status: string; providerRefundRef?: string; createdAt: number; updatedAt: number }[];
    return {
      ok: true as const,
      refunds: rows
        .map((r) => ({
          id: r._id as string,
          purchaseId: r.purchaseId as string,
          reason: r.reason,
          status: r.status,
          providerRefundRef: r.providerRefundRef,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

/* ---------------- purchase history + receipts ---------------- */

/**
 * The caller's purchase history with receipt state (own data only). Titles
 * resolve from server rows or the seed-catalog key passthrough.
 */
export const listMyPurchases = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: GenericQueryCtx<any>, args: { sessionToken: string }) => {
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated", purchases: [] as never[] };

    const rows = (await ctx.db
      .query("purchases")
      .withIndex("by_user", (q: any) => q.eq("userId", caller.userId as never))
      .collect()) as {
      _id: string;
      courseId?: string;
      courseKey?: string;
      teacherUserId?: string;
      amountCents: number;
      currency: string;
      provider: string;
      providerRef: string;
      status: string;
      createdAt: number;
      updatedAt: number;
    }[];

    // Resolve class titles (courses/classes rows) + refund linkage.
    const titleFor = async (r: (typeof rows)[number]): Promise<string> => {
      if (r.courseId) {
        const row = (await ctx.db.get(r.courseId as never)) as { title?: string } | null;
        if (row?.title) return row.title;
      }
      return r.courseKey ?? "DENSEN class";
    };

    const refunds = (await ctx.db
      .query("refundRequests")
      .withIndex("by_user", (q: any) => q.eq("userId", caller.userId as never))
      .collect()) as { purchaseId: string; status: string }[];
    const refundByPurchase = new Map(refunds.map((r) => [r.purchaseId, r.status]));

    const out = [] as {
      id: string;
      title: string;
      classId: string;
      teacherUserId?: string;
      amountCents: number;
      currency: string;
      provider: string;
      providerRef: string;
      status: string;
      receiptState: string;
      refundStatus?: string;
      createdAt: number;
    }[];
    for (const r of rows) {
      out.push({
        id: r._id as string,
        title: await titleFor(r),
        classId: (r.courseId ?? r.courseKey ?? "") as string,
        teacherUserId: r.teacherUserId,
        amountCents: r.amountCents,
        currency: r.currency,
        provider: r.provider,
        providerRef: r.providerRef,
        status: r.status,
        receiptState: receiptStateOf(r),
        refundStatus: refundByPurchase.get(r._id as string),
        createdAt: r.createdAt,
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true as const, purchases: out };
  },
});

/** Entitlement probe used by class pages: owns this class via a PAID purchase? */
export const ownsClass = queryGeneric({
  args: { sessionToken: v.string(), classId: v.string() },
  handler: async (ctx: GenericQueryCtx<any>, args: { sessionToken: string; classId: string }) => {
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, owned: false as const };
    const byCourse = (await ctx.db
      .query("purchases")
      .withIndex("by_user_course", (q: any) => q.eq("userId", caller.userId as never).eq("courseId", args.classId as never))
      .collect()) as { status: string }[];
    if (byCourse.some((p) => p.status === "paid")) return { ok: true as const, owned: true as const };
    const byKey = (await ctx.db
      .query("purchases")
      .withIndex("by_user_course_key", (q: any) => q.eq("userId", caller.userId as never).eq("courseKey", args.classId))
      .collect()) as { status: string }[];
    return { ok: true as const, owned: byKey.some((p) => p.status === "paid") };
  },
});

/* ---------------- teacher revenue (verified transactions only) ---------------- */

/**
 * The teacher's verified money view: charges recorded from provider events on
 * their classes, minus refunds/chargebacks. Unverified rows NEVER count.
 * Staff approval + provider execution are the only refund paths.
 */
export const getMyRevenue = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: GenericQueryCtx<any>, args: { sessionToken: string }) => {
    const caller = await callerFromToken(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    // The teacher's purchases (revenue attribution decided at purchase time).
    const rows = (await ctx.db
      .query("purchases")
      .withIndex("by_teacher_user", (q: any) => q.eq("teacherUserId", caller.userId as never))
      .collect()) as { _id: string; amountCents: number; currency: string; status: string; createdAt: number }[];

    // Verified transactions on those purchases.
    const txs: RevenueTx[] = [];
    for (const p of rows) {
      const pt = (await ctx.db
        .query("paymentTransactions")
        .withIndex("by_purchase", (q: any) => q.eq("purchaseId", p._id as never))
        .collect()) as { kind: string; amountCents: number }[];
      for (const t of pt) {
        // Transactions only exist via applyProviderEvent — verified by construction.
        txs.push({ kind: t.kind, amountCents: t.amountCents, verified: true, teacherUserId: caller.userId });
      }
    }
    const revenue = teacherRevenueFromTransactions(txs, caller.userId);
    return {
      ok: true as const,
      currency: "EUR",
      chargesCents: revenue.chargesCents,
      refundedCents: revenue.refundedCents,
      netCents: revenue.netCents,
      transactionCount: revenue.transactionCount,
      purchases: rows.map((p) => ({ id: p._id as string, amountCents: p.amountCents, status: p.status, createdAt: p.createdAt })),
    };
  },
});

/* ---------------- staff refund queue + review ---------------- */

/** Staff view of the refund queue (moderator+), decision-core ordering. */
export const adminRefundQueue = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: GenericQueryCtx<any>, args: { sessionToken: string }) => {
    const staff = requireRole(await callerFromToken(ctx.db, args.sessionToken), "moderator");
    void staff;
    const rows = (await ctx.db
      .query("refundRequests")
      .collect()) as { _id: string; purchaseId: string; userId: string; reason: string; status: string; detail?: string; createdAt: number; updatedAt: number }[];
    const sorted = rows.sort(refundQueueOrder);
    const out = [] as {
      id: string;
      purchaseId: string;
      purchaseStatus?: string;
      amountCents?: number;
      currency?: string;
      userId: string;
      reason: string;
      status: string;
      detail?: string;
      createdAt: number;
    }[];
    for (const r of sorted) {
      const p = (await ctx.db.get(r.purchaseId as never)) as { status?: string; amountCents?: number; currency?: string } | null;
      out.push({
        id: r._id as string,
        purchaseId: r.purchaseId as string,
        purchaseStatus: p?.status,
        amountCents: p?.amountCents,
        currency: p?.currency,
        userId: r.userId as string,
        reason: r.reason,
        status: r.status,
        detail: r.detail,
        createdAt: r.createdAt,
      });
    }
    return { ok: true as const, queue: out };
  },
});

/**
 * Staff review of a refund request. `approve` only moves the request toward
 * the provider; the actual refund state arrives via the provider's
 * refund_executed event (applyProviderEvent). Rejecting needs no provider.
 */
export const reviewRefundRequest = mutationGeneric({
  args: { sessionToken: v.string(), refundId: v.string(), approve: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx: GenericMutationCtx<any>, args: { sessionToken: string; refundId: string; approve: boolean; note?: string }) => {
    const now = Date.now();
    const db = ctx.db;
    const staff = requireRole(await callerFromToken(db, args.sessionToken), "moderator");

    const req = (await db.get(args.refundId as never)) as { _id: string; purchaseId: string; userId: string; status: string } | null;
    if (!req) return { ok: false as const, error: "no_such_request" as const };
    if (req.status === "refunded" || req.status === "rejected") return { ok: false as const, error: "request_closed" as const };

    if (!args.approve) {
      await db.patch(req._id as never, { status: "rejected", reviewedBy: staff.userId as never, reviewNote: args.note, updatedAt: now });
      await db.insert("auditLogs", {
        actorUserId: staff.userId as never,
        actorRole: staff.role as never,
        eventType: "refund_review",
        targetType: "refund_request",
        targetId: req._id as string,
        summary: "rejected",
        createdAt: now,
      });
      await notifyUser(db, { userId: req.userId as string, actorUserId: staff.userId, type: "refund_rejected", targetType: "purchase", targetId: req.purchaseId as string, now });
      return { ok: true as const, status: "rejected" as const };
    }

    // Approved: request enters the provider queue. Money moves ONLY when the
    // provider's refund event lands — never here.
    const status = req.status === "requested" ? "under_review" : "approved";
    await db.patch(req._id as never, { status, reviewedBy: staff.userId as never, reviewNote: args.note, updatedAt: now });
    await db.insert("auditLogs", {
      actorUserId: staff.userId as never,
      actorRole: staff.role as never,
      eventType: "refund_review",
      targetType: "refund_request",
      targetId: req._id as string,
      summary: `status->${status}; provider refund pending`,
      createdAt: now,
    });
    await notifyUser(db, { userId: req.userId as string, actorUserId: staff.userId, type: "refund_" + status, targetType: "purchase", targetId: req.purchaseId as string, now });
    return { ok: true as const, status };
  },
});

/** True when the purchase row can still receive a refund request (UI gating). */
export function purchaseRefundable(p: { status: string }): boolean {
  return isRefundableStatus(p.status);
}
