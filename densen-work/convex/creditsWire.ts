/**
 * DENSEN — Dance Credits wire functions (Day 10).
 * ===============================================
 * Credits are the platform reward currency (never money, never a credit
 * score). Every balance change is one signed row in `creditTransactions`
 * (source of truth) plus the denormalized `profiles.creditBalance` patched
 * in the SAME mutation (schema invariant). Convex mutations are
 * serializable transactions, so balance checks + writes are atomic —
 * negative balances and concurrent double-spends are structurally
 * impossible.
 *
 * Surfaces:
 *  - earnCredit (INTERNAL): called from the server's own verified flows.
 *    There is deliberately NO public earn endpoint — clients cannot mint.
 *  - spendCredits: unlock a class with credits; replay-safe via the
 *    ledger's (user, reason, refId) idempotency probe.
 *  - getMyCredits: reactive balance + history (own data only).
 *  - adminAdjustCredits: admin-only, reason required, audit-logged.
 *  - fixCreditBalance: self-heal the denormalized balance from the ledger.
 */
import { v } from "convex/values";
import { mutationGeneric, queryGeneric, internalMutationGeneric } from "convex/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { decideAdminAdjust, decideCreditSpend, type CreditSource } from "./credits";
import {
  appendCreditTx,
  currentBalance,
  earnCreditsFor,
  reasonFor,
} from "./creditsInternals";
import { callerFromToken } from "./content";
import { requireRole } from "./security";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------------- earn (internal — no public mint) ---------------- */

/**
 * Internal earn: the ONLY way credits enter circulation outside admin
 * adjustments. Callers are the server's own verified flows; the decision
 * core enforces idempotency (one reward per user+source+ref) and daily
 * caps for refId-less kinds. Exposed for scheduled/mission flows.
 */
export const earnCredit = internalMutationGeneric({
  args: {
    userId: v.id("users"),
    source: v.string(),
    refId: v.optional(v.string()),
  },
  handler: async (ctx: any, args: { userId: string; source: string; refId?: string }) => {
    const pay = await earnCreditsFor(ctx.db, args.userId, args.source as CreditSource, args.refId, Date.now());
    if (pay.error) return { ok: false as const, error: pay.error as never, credits: 0 };
    return { ok: true as const, credits: pay.granted };
  },
});

/* ---------------- spend (class unlock) ---------------- */

/**
 * Spend credits to unlock a class/course. Replay-safe: the unlock record
 * is a ledger row with reason "spend" and refId `class:<key>` — a replay
 * hits the same probe and returns `duplicate_unlock` instead of double-
 * spending. The amount is caller-supplied for seed-catalog classes
 * (their pricing lives in the client catalog); Studio-published classes
 * could resolve it server-side — the refId probe keeps either path
 * idempotent. Balance goes negative only if the invariant was already
 * broken; the decision core forbids it from a healthy balance.
 */
export const spendCredits = mutationGeneric({
  args: {
    sessionToken: v.string(),
    amount: v.number(),
    courseKey: v.optional(v.string()),
  },
  handler: async (ctx: GenericMutationCtx<any>, args: { sessionToken: string; amount: number; courseKey?: string }) => {
    const now = Date.now();
    const db = ctx.db;
    const c = await callerFromToken(db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const refId = args.courseKey ? `class:${args.courseKey}` : undefined;

    // Replay probe — an already-recorded unlock never charges twice.
    if (refId) {
      const dup = (await db
        .query("creditTransactions")
        .withIndex("by_user_reason_ref", (q: any) =>
          q.eq("userId", c.userId).eq("reason", "spend").eq("refId", refId)
        )
        .first()) as unknown;
      if (dup !== null) return { ok: false as const, error: "duplicate_unlock" as const };
    }

    const balance = await currentBalance(db, c.userId);
    const decision = decideCreditSpend({ balance, amount: args.amount });
    if (decision.action === "deny")
      return { ok: false as const, error: decision.error as "insufficient_credits" | "invalid_amount" };

    await appendCreditTx(
      db, c.userId, -args.amount, "spend", args.courseKey ? "class" : "manual",
      refId, decision.balanceAfter, now
    );
    return { ok: true as const, balance: decision.balanceAfter };
  },
});

/* ---------------- my credits (reactive) ---------------- */

/** Balance + recent history for the signed-in dancer (own data only). */
export const getMyCredits = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: GenericQueryCtx<any>, args: { sessionToken: string }) => {
    const c = await callerFromToken(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated", balance: 0, history: [] as unknown[] };

    const rows = (await ctx.db
      .query("creditTransactions")
      .withIndex("by_user_time", (q: any) => q.eq("userId", c.userId))
      .order("desc")
      .take(50)) as { amount: number; reason: string; refType?: string; refId?: string; balanceAfter: number; createdAt: number }[];

    return {
      ok: true as const,
      balance: await currentBalance(ctx.db, c.userId),
      history: rows.map((r) => ({
        amount: r.amount,
        reason: r.reason,
        refType: r.refType,
        refId: r.refId,
        balanceAfter: r.balanceAfter,
        at: r.createdAt,
      })),
    };
  },
});

/* ---------------- admin adjustments (logged) ---------------- */

/**
 * Admin grant/clawback. The staff gate is fail-closed (`requireRole`),
 * the reason is mandatory, and the decision + audit row live in the same
 * transaction — adjustments cannot be made without a trace.
 */
export const adminAdjustCredits = mutationGeneric({
  args: {
    sessionToken: v.string(),
    targetUserId: v.id("users"),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx: GenericMutationCtx<any>, args: { sessionToken: string; targetUserId: string; amount: number; reason: string }) => {
    const now = Date.now();
    const db = ctx.db;
    const admin = requireRole(await callerFromToken(db, args.sessionToken), "admin");

    const target = await db.get(args.targetUserId as never);
    if (!target) return { ok: false as const, error: "no_such_user" as const };

    const balance = await currentBalance(db, args.targetUserId);
    const decision = decideAdminAdjust({ amount: args.amount, balance });
    if (decision.action === "deny")
      return { ok: false as const, error: decision.error as "invalid_amount" | "negative_balance" };

    await appendCreditTx(
      db, args.targetUserId, args.amount, "admin_adjust", "admin",
      admin.userId, decision.balanceAfter, now
    );
    await db.insert("auditLogs", {
      actorUserId: admin.userId as never,
      actorRole: admin.role as never,
      eventType: "credit_admin_adjust",
      targetType: "user",
      targetId: args.targetUserId,
      summary: `amount:${args.amount}; reason:${args.reason}; balanceAfter:${decision.balanceAfter}`,
      createdAt: now,
    });
    return { ok: true as const, balance: decision.balanceAfter };
  },
});

/* ---------------- balance self-heal ---------------- */

/**
 * Reconcile the denormalized profile balance from the ledger (the source
 * of truth). If the snapshot ever drifts, one call repairs it — and the
 * repair itself is a logged audit row so the history stays a faithful
 * audit trail.
 */
export const fixCreditBalance = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: GenericMutationCtx<any>, args: { sessionToken: string }) => {
    const now = Date.now();
    const db = ctx.db;
    const c = await callerFromToken(db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const rows = (await db
      .query("creditTransactions")
      .withIndex("by_user_time", (q: any) => q.eq("userId", c.userId))
      .order("desc")
      .take(1000)) as { amount: number }[];
    const trueBalance = rows.reduce((s, r) => s + r.amount, 0);
    const profile = (await db
      .query("profiles")
      .withIndex("userId", (q: any) => q.eq("userId", c.userId))
      .unique()) as { _id: string; creditBalance: number } | null;
    if (!profile) return { ok: false as const, error: "no_profile" as const };
    if (profile.creditBalance === trueBalance) {
      return { ok: true as const, balance: trueBalance, fixed: 0 as const };
    }
    const delta = trueBalance - profile.creditBalance;
    await db.patch(profile._id as never, { creditBalance: trueBalance, updatedAt: now } as never);
    await db.insert("auditLogs", {
      actorUserId: c.userId as never,
      actorRole: c.role as never,
      eventType: "credit_balance_repair",
      targetType: "user",
      targetId: c.userId,
      summary: `drift:${delta}; corrected_to:${trueBalance}`,
      createdAt: now,
    });
    return { ok: true as const, balance: trueBalance, fixed: delta };
  },
});

// Re-export for other modules importing from the wire surface.
export { reasonFor };
