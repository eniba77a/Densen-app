/**
 * Day 10 — DENSEN Dance Credits core tests.
 * Pins the reward-economy rules: credits are earned only through verified
 * activity (idempotent, daily-capped, never client-minted), spending can
 * never overdraw (negative-balance guard), admin adjustments are signed
 * and bounded by the balance, and the €→credit recommendation stays
 * configurable (never hard-coded into the economy).
 */
import { describe, expect, it } from "vitest";
import {
  CREDIT_SOURCES,
  CREDIT_VALUES,
  CREDIT_DAILY_CAPS,
  REASON_FOR_SOURCE,
  balanceFromLedger,
  decideAdminAdjust,
  decideCreditEarn,
  decideCreditSpend,
  recommendCreditPrice,
} from "../../convex/credits";

const CALLER = { userId: "u1", userStatus: "active" };
const NOW = Date.parse("2026-09-23T12:00:00Z");

describe("credits: earn rules", () => {
  it("grants the configured value for a verified activity", () => {
    const d = decideCreditEarn({
      caller: CALLER, source: "lesson_complete", refId: "basic-groove",
      alreadyPaid: false, paidToday: 0, now: NOW,
    });
    expect(d).toEqual({ action: "grant", credits: CREDIT_VALUES.lesson_complete });
  });

  it("never double-pays the same (user, source, ref) — duplicate rewards and replay abuse impossible", () => {
    const d = decideCreditEarn({
      caller: CALLER, source: "challenge_complete", refId: "ch-9",
      alreadyPaid: true, paidToday: 0, now: NOW,
    });
    expect(d).toEqual({ action: "deny", error: "duplicate_reward" });
  });

  it("denies suspended accounts", () => {
    const d = decideCreditEarn({
      caller: { userId: "u1", userStatus: "suspended" }, source: "lesson_complete",
      refId: "l1", alreadyPaid: false, paidToday: 0, now: NOW,
    });
    expect(d).toEqual({ action: "deny", error: "suspended" });
  });

  it("denies unknown sources — the earn surface is a closed set", () => {
    const d = decideCreditEarn({
      caller: CALLER, source: "self_mint" as never, refId: "x",
      alreadyPaid: false, paidToday: 0, now: NOW,
    });
    expect(d).toEqual({ action: "deny", error: "unknown_source" });
  });

  it("refuses admin adjustments through the earn path", () => {
    const d = decideCreditEarn({
      caller: CALLER, source: "admin_adjust", refId: "whatever",
      alreadyPaid: false, paidToday: 0, now: NOW,
    });
    expect(d).toEqual({ action: "deny", error: "unknown_source" });
  });

  it("requires a ref for uncapped sources (no farming surface)", () => {
    const d = decideCreditEarn({
      caller: CALLER, source: "mission_claim", refId: undefined,
      alreadyPaid: false, paidToday: 0, now: NOW,
    });
    expect(d).toEqual({ action: "deny", error: "ref_required" });
  });

  it("daily-caps refId-less recurring kinds (spam farming defense)", () => {
    const cap = CREDIT_DAILY_CAPS.event_reward!;
    const ok = decideCreditEarn({
      caller: CALLER, source: "event_reward", refId: undefined,
      alreadyPaid: false, paidToday: cap - 1, now: NOW,
    });
    expect(ok.action).toBe("grant");
    const capped = decideCreditEarn({
      caller: CALLER, source: "event_reward", refId: undefined,
      alreadyPaid: false, paidToday: cap, now: NOW,
    });
    expect(capped).toEqual({ action: "deny", error: "daily_cap" });
  });
});

describe("credits: spend rules", () => {
  it("spends from a sufficient balance", () => {
    const d = decideCreditSpend({ balance: 8, amount: 8 });
    expect(d).toEqual({ action: "spend", balanceAfter: 0 });
  });

  it("never allows a negative balance", () => {
    const d = decideCreditSpend({ balance: 3, amount: 8 });
    expect(d).toEqual({ action: "deny", error: "insufficient_credits" });
  });

  it("rejects non-positive and fractional amounts", () => {
    for (const amount of [0, -5, 2.5]) {
      const d = decideCreditSpend({ balance: 100, amount });
      expect(d).toEqual({ action: "deny", error: "invalid_amount" });
    }
  });
});

describe("credits: admin adjustments", () => {
  it("applies signed adjustments", () => {
    expect(decideAdminAdjust({ amount: 5, balance: 2 })).toEqual({ action: "adjust", balanceAfter: 7 });
    expect(decideAdminAdjust({ amount: -2, balance: 2 })).toEqual({ action: "adjust", balanceAfter: 0 });
  });

  it("clawbacks can never push the balance negative", () => {
    const d = decideAdminAdjust({ amount: -9, balance: 2 });
    expect(d).toEqual({ action: "deny", error: "negative_balance" });
  });

  it("rejects zero and fractional amounts", () => {
    expect(decideAdminAdjust({ amount: 0, balance: 10 }).action).toBe("deny");
    expect(decideAdminAdjust({ amount: 1.5, balance: 10 }).action).toBe("deny");
  });
});

describe("credits: configurable conversion (presentation only)", () => {
  it("recommends ~1 credit per euro — the €8 class unlocks for 8 credits", () => {
    expect(recommendCreditPrice(800)).toBe(8);
    expect(recommendCreditPrice(490)).toBe(5); // rounded
    expect(recommendCreditPrice(0)).toBe(0);
  });

  it("recommendation is derived from the configurable rate, not hard-coded per class", () => {
    // The function only ever reads CREDITS_PER_EUR — changing the constant
    // re-prices every recommendation; class rows keep their own creditPrice.
    expect(recommendCreditPrice(3000)).toBe(30);
  });
});

describe("credits: ledger integrity", () => {
  it("every source maps to a schema reason (closed vocabulary)", () => {
    for (const s of CREDIT_SOURCES) expect(REASON_FOR_SOURCE[s]).toBeDefined();
  });

  it("balance equals the signed ledger sum", () => {
    const rows = [{ amount: 1 }, { amount: 2 }, { amount: -1 }, { amount: 8 }];
    expect(balanceFromLedger(rows)).toBe(10);
    expect(balanceFromLedger([])).toBe(0);
  });
});
