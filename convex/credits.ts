/**
 * DENSEN — Dance Credits decision core (Day 10).
 * ===============================================
 * Dance Credits are the platform's **reward currency**: earned through
 * meaningful dance activity, spendable to unlock classes. They are NOT
 * money, not a financial credit score, and never purchasable with money.
 *
 * Money and credits are two different ledgers (xpTransactions /
 * creditTransactions). The EUR↔credit conversion is a *presentation-time*
 * recommendation (1 credit ≈ €1) so class pages can show "€8 · 8 ✦" —
 * it is configurable per class row and never hard-coded into the economy.
 *
 * Guarantees enforced here and by the wire module:
 *   - earn: server-driven reasons only; one reward per (user, reason, ref)
 *     (idempotent — duplicate rewards and replay abuse impossible);
 *     refId-less recurring kinds are daily-capped (spam-farming defense);
 *     suspended accounts can never earn.
 *   - spend: balance is checked and written inside one mutation (Convex
 *     transactions are serializable), balance can never go negative;
 *     every spend is one row in `creditTransactions` with balanceAfter.
 *   - admin adjustments: only via the admin role; always logged (reason
 *     required, audit row written by the wire module).
 */

/* ---------------- earn policy ---------------- */

/**
 * Which sources may mint credits. Everything here is triggered by a
 * *server-verified* event (a completion mutation, the arcade ledger, a
 * claim) — never by a client "give me credits" call. That is the
 * unauthorized-manipulation defense: there is no public earn endpoint.
 */
export const CREDIT_SOURCES = [
  "lesson_complete",
  "combo_complete",
  "choreography_complete",
  "challenge_complete",
  "streak_milestone",
  "achievement",
  "mission_claim",
  "event_reward",
  "admin_adjust",
] as const;

export type CreditSource = (typeof CREDIT_SOURCES)[number];

/**
 * Credits per meaningful activity. Configurable in one table — same
 * pattern as the arcade's XP_VALUES (change here, behavior changes
 * everywhere). Values are deliberately modest: credits unlock classes.
 */
export const CREDIT_VALUES: Readonly<Record<Exclude<CreditSource, "admin_adjust">, number>> = {
  lesson_complete: 1,
  combo_complete: 1,
  choreography_complete: 2,
  challenge_complete: 2,
  streak_milestone: 1,
  achievement: 2,
  mission_claim: 3,
  event_reward: 5,
};

/** Default conversion helper — presentation only (never an exchange). */
export const CREDITS_PER_EUR = 1;

/**
 * Ledger `reason` literal for each earn source (the schema union is a
 * closed set — earn/reward flows always record "reward", admin flows
 * "admin_adjust"). Kept in the pure core so parity is unit-testable.
 */
export const REASON_FOR_SOURCE: Readonly<Record<CreditSource, "reward" | "admin_adjust">> = {
  lesson_complete: "reward",
  combo_complete: "reward",
  choreography_complete: "reward",
  challenge_complete: "reward",
  streak_milestone: "reward",
  achievement: "reward",
  mission_claim: "reward",
  event_reward: "reward",
  admin_adjust: "admin_adjust",
};

/** Recommend a credit price from a EUR price. Configurable, never binding. */
export function recommendCreditPrice(priceCents: number): number {
  return Math.max(0, Math.round(priceCents / 100 / CREDITS_PER_EUR));
}

/* ---------------- earn decision (pure) ---------------- */

export interface EarnInput {
  caller: { userId: string; userStatus: string };
  source: CreditSource;
  refId?: string;
  /** Row found by the idempotency probe (one per user+source+ref). */
  alreadyPaid: boolean;
  /** Paid refId-less rows of this source since UTC midnight (cap probe). */
  paidToday: number;
  now: number;
}

export type EarnDecision =
  | { action: "grant"; credits: number }
  | { action: "deny"; error: "suspended" | "unknown_source" | "duplicate_reward" | "daily_cap" | "ref_required" };

/** Recurring refId-less sources get a daily cap (spam-farming defense). */
export const CREDIT_DAILY_CAPS: Readonly<Partial<Record<CreditSource, number>>> = {
  event_reward: 1,
};

export function decideCreditEarn(input: EarnInput): EarnDecision {
  if (input.caller.userStatus === "suspended") return { action: "deny", error: "suspended" };
  const value = (CREDIT_VALUES as Readonly<Record<string, number | undefined>>)[input.source];
  if (value === undefined) return { action: "deny", error: "unknown_source" };
  // Admin adjustments never flow through the earn path.
  if (input.source === "admin_adjust") return { action: "deny", error: "unknown_source" };
  if (input.refId === undefined || input.refId === "") {
    const cap = CREDIT_DAILY_CAPS[input.source];
    if (cap === undefined) return { action: "deny", error: "ref_required" };
    if (input.paidToday >= cap) return { action: "deny", error: "daily_cap" };
    return { action: "grant", credits: value };
  }
  if (input.alreadyPaid) return { action: "deny", error: "duplicate_reward" };
  return { action: "grant", credits: value };
}

/* ---------------- spend decision (pure) ---------------- */

export interface SpendInput {
  /** Balance BEFORE the spend (read inside the same mutation). */
  balance: number;
  amount: number;
}

export type SpendDecision =
  | { action: "spend"; balanceAfter: number }
  | { action: "deny"; error: "insufficient_credits" | "invalid_amount" };

/**
 * Balance can never go negative — the check and the write happen inside
 * one serializable Convex mutation, so a concurrent double-spend would
 * serialize and the loser sees the post-first balance.
 */
export function decideCreditSpend(input: SpendInput): SpendDecision {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { action: "deny", error: "invalid_amount" };
  }
  if (input.balance < input.amount) return { action: "deny", error: "insufficient_credits" };
  return { action: "spend", balanceAfter: input.balance - input.amount };
}

/* ---------------- admin adjustment (pure) ---------------- */

export interface AdminAdjustInput {
  amount: number;
  /** Balance BEFORE the adjustment. */
  balance: number;
}

export type AdminAdjustDecision =
  | { action: "adjust"; balanceAfter: number }
  | { action: "deny"; error: "invalid_amount" | "negative_balance" };

/** Admin grants and clawbacks are signed integers; balance stays ≥ 0. */
export function decideAdminAdjust(input: AdminAdjustInput): AdminAdjustDecision {
  if (!Number.isInteger(input.amount) || input.amount === 0) return { action: "deny", error: "invalid_amount" };
  const balanceAfter = input.balance + input.amount;
  if (balanceAfter < 0) return { action: "deny", error: "negative_balance" };
  return { action: "adjust", balanceAfter };
}

/* ---------------- balance integrity (pure) ---------------- */

/** The denormalized `profiles.creditBalance` must equal the ledger sum. */
export function balanceFromLedger(rows: { amount: number }[]): number {
  return rows.reduce((sum, r) => sum + r.amount, 0);
}
