/**
 * DENSEN — Dance Credits wire functions (Day 10, Day 23 update).
 * ==============================================================
 * Credits are the platform loyalty currency for REWARDS only. Day 23 made
 * Densen a completely free platform: the credit-SPEND (class unlock) path
 * was removed — no lesson is ever gated behind credits or money. Credits
 * remain a no-cash loyalty ledger (earn/reward/admin-adjust), exactly like
 * XP. Every balance change is one signed row in `creditTransactions`
 * (source of truth) plus the denormalized `profiles.creditBalance` patched
 * in the SAME mutation (schema invariant). Convex mutations are
 * serializable transactions, so concurrent double-writes are structurally
 * impossible.
 *
 * Surfaces:
 *  - earnCredit (INTERNAL): called from the server's own verified flows.
 *    There is deliberately NO public earn endpoint — clients cannot mint.
 *  - getMyCredits: reactive balance + history (own data only).
 *  - adminAdjustCredits: admin-only, reason required, audit-logged.
 *  - fixCreditBalance: self-heal the denormalized balance from the ledger.
 *
 * REMOVED (Day 23): `spendCredits` — the credit-unlock purchase path. The
 * ledger keeps every historical row for transparency, but nothing spends
 * credits anymore and no lesson access depends on them.
 */
import { v } from "convex/values";
import { mutationGeneric, queryGeneric, internalMutationGeneric } from "convex/server";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { decideAdminAdjust, type CreditSource } from "./credits";
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
