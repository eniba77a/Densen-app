/**
 * DENSEN — Credits internals (Day 10).
 * ====================================
 * Shared balance + earn plumbing used by the credits wire module (the
 * earn mutation, admin adjustments) and by other server flows that pay
 * credits inside their own verified transactions (the arcade ledger,
 * streak milestones, future achievement/mission claims).
 *
 * Dependency-light by design (only ./credits) so importing modules never
 * create cycles — mirrors the arcadeInternals convention.
 */
import { REASON_FOR_SOURCE, decideCreditEarn, type CreditSource } from "./credits";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** All reasons a credit row may carry (schema union + Day 6 reaction). */
export const CREDIT_REASONS = [
  "earn",
  "purchase",
  "spend",
  "reward",
  "refund",
  "expire",
  "admin_adjust",
  "reaction",
] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

/** Ledger `reason` literal for an earn source (pure core owns the map). */
export function reasonFor(source: CreditSource): CreditReason {
  return REASON_FOR_SOURCE[source] ?? "reward";
}

/** Read the user's current balance: denormalized profile, ledger fallback. */
export async function currentBalance(db: any, userId: string): Promise<number> {
  const profile = (await db
    .query("profiles")
    .withIndex("userId", (q: any) => q.eq("userId", userId))
    .unique()) as { creditBalance: number } | null;
  if (profile) return profile.creditBalance;
  const last = (await db
    .query("creditTransactions")
    .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
    .order("desc")
    .first()) as { balanceAfter: number } | null;
  return last?.balanceAfter ?? 0;
}

/**
 * Append one ledger row and patch the denormalized profile balance in the
 * SAME mutation — the schema invariant. `balanceAfter` comes from the
 * caller, who must have read the balance inside this transaction.
 */
export async function appendCreditTx(
  db: any,
  userId: string,
  amount: number,
  reason: CreditReason,
  refType: string | undefined,
  refId: string | undefined,
  balanceAfter: number,
  now: number
): Promise<void> {
  await db.insert("creditTransactions", {
    userId: userId as never,
    amount,
    balanceAfter,
    reason,
    refType,
    refId,
    createdAt: now,
  });
  const profile = (await db
    .query("profiles")
    .withIndex("userId", (q: any) => q.eq("userId", userId))
    .unique()) as { _id: string } | null;
  if (profile) await db.patch(profile._id as never, { creditBalance: balanceAfter, updatedAt: now } as never);
}

/**
 * Earn credits for one verified event. Returns the granted amount (0 +
 * error when denied). Idempotent per (user, source, refId) — the probe
 * matches on reason + refId and distinguishes sources via refType, so
 * two sources sharing a ref can never collide. RefId-less kinds are
 * daily-capped (UTC day). NEVER call this from a client-reachable path
 * with client-chosen sources: only server-verified flows mint credits.
 */
export async function earnCreditsFor(
  db: any,
  userId: string,
  source: CreditSource,
  refId: string | undefined,
  now: number,
  amountOverride?: number
): Promise<{ granted: number; error?: string }> {
  const reason = reasonFor(source);

  let alreadyPaid = false;
  if (refId) {
    const dup = (await db
      .query("creditTransactions")
      .withIndex("by_user_reason_ref", (q: any) =>
        q.eq("userId", userId).eq("reason", reason).eq("refId", refId)
      )
      .collect()) as { refType?: string }[];
    alreadyPaid = dup.some((r) => r.refType === source);
  }

  let paidToday = 0;
  if (!refId) {
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const rows = (await db
      .query("creditTransactions")
      .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
      .order("desc")
      .take(200)) as { reason: string; refId?: string; createdAt: number }[];
    paidToday = rows.filter(
      (r) => r.reason === reason && !r.refId && r.createdAt >= dayStart.getTime()
    ).length;
  }

  const user = await db.get(userId);
  const decision = decideCreditEarn({
    caller: { userId, userStatus: (user as { status?: string } | null)?.status ?? "active" },
    source,
    refId,
    alreadyPaid,
    paidToday,
    now,
  });
  if (decision.action === "deny") return { granted: 0, error: decision.error };

  const credits = Math.max(0, amountOverride ?? decision.credits);
  if (credits === 0) return { granted: 0 };
  const balance = await currentBalance(db, userId);
  const balanceAfter = balance + credits;
  // refType = source: per-source idempotency inside one ledger reason.
  await appendCreditTx(db, userId, credits, reason, source, refId, balanceAfter, now);
  return { granted: credits };
}
