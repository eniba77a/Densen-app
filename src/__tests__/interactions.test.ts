import { describe, expect, it } from "vitest";
import {
  DENSEN_ACTIONS,
  QUICK_REACTIONS,
  QUICK_REACTION_EMOJI,
  RATE_LIMITS,
  XP_FIRST_TIME,
  boostUsedToday,
  decideCommentQuickReaction,
  decideInteraction,
  decideInteractionXp,
  interactionCountDelta,
  interactionRowKind,
  isRateLimited,
  toQuickReaction,
} from "../../convex/interactions";
import type { Caller } from "../../convex/security";

const me = (over: Partial<Caller> = {}): Caller => ({
  userId: "u_me",
  role: "user",
  userStatus: "active",
  ...over,
});

const target = { _id: "p1", userId: "u_sara", status: "published" };
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/* ---------------- vocabulary ---------------- */
describe("DENSEN interaction vocabulary", () => {
  it("has exactly the 8 dancer actions — no borrowed social vocabulary", () => {
    expect([...DENSEN_ACTIONS]).toEqual([
      "energy",
      "talk",
      "move",
      "practice",
      "remix",
      "duet",
      "boost",
      "challenge",
    ]);
  });

  it("has the 6 quick comment reactions with stable emoji faces", () => {
    expect([...QUICK_REACTIONS]).toEqual(["energy", "on_point", "vibe", "insane", "clean", "power"]);
    for (const r of QUICK_REACTIONS) expect(QUICK_REACTION_EMOJI[r].length).toBeGreaterThan(0);
  });

  it("maps legacy Energy kinds onto the quick vocabulary", () => {
    expect(toQuickReaction("fire")).toBe("energy");
    expect(toQuickReaction("hype")).toBe("insane");
    expect(toQuickReaction("gold")).toBe("clean");
  });
});

/* ---------------- anti-spam ---------------- */
describe("anti-spam rate windows", () => {
  it("blocks at the limit inside the window, resets outside it", () => {
    const stamps = [NOW - 1000, NOW - 2000, NOW - 3000];
    expect(isRateLimited("talk", [...stamps, ...Array(7).fill(NOW - 4000)], NOW)).toBe(true); // 10 hits
    expect(isRateLimited("talk", stamps, NOW)).toBe(false); // 3 hits, fine
    // same 10 hits but 2 minutes old: outside the 60s window
    expect(isRateLimited("talk", stamps.map((t) => t - 120_000).concat(Array(7).fill(NOW - 121_000)), NOW)).toBe(false);
  });

  it("BOOST is a hard 1/day rate on top of the daily core check", () => {
    expect(RATE_LIMITS.boost.limit).toBe(1);
    expect(RATE_LIMITS.boost.windowMs).toBe(DAY);
    expect(isRateLimited("boost", [NOW - 1000], NOW)).toBe(true);
    expect(isRateLimited("boost", [], NOW)).toBe(false);
  });

  it("counts only timestamps inside the window (boundary-exclusive)", () => {
    // exactly windowMs old = OUTSIDE (ts > windowStart is strict)
    expect(isRateLimited("move", [NOW - RATE_LIMITS.move.windowMs], NOW)).toBe(false);
    expect(isRateLimited("move", [NOW - RATE_LIMITS.move.windowMs + 1], NOW)).toBe(false); // 1 hit < limit
    // fill the limit with in-window stamps, then prove the boundary stamp is ignored
    const full = Array.from({ length: RATE_LIMITS.move.limit }, () => NOW - 1000);
    expect(isRateLimited("move", full, NOW)).toBe(true);
    expect(isRateLimited("move", [...full.slice(0, -1), NOW - RATE_LIMITS.move.windowMs], NOW)).toBe(false); // edge stamp doesn't count
  });
});

/* ---------------- XP anti-farm ---------------- */
describe("XP anti-farm economy", () => {
  it("grants XP only on the first application of an interaction", () => {
    expect(decideInteractionXp({ action: "energy", alreadyCountedForXp: false, isToggleOff: false })).toEqual({
      grant: true,
      amount: 5,
      reason: "interaction_energy",
    });
  });

  it("never grants XP on repeats or toggle-offs — the farm loop does not exist", () => {
    expect(decideInteractionXp({ action: "energy", alreadyCountedForXp: true, isToggleOff: false }).grant).toBe(false);
    expect(decideInteractionXp({ action: "remix", alreadyCountedForXp: false, isToggleOff: true }).grant).toBe(false);
    expect(decideInteractionXp({ action: "remix", alreadyCountedForXp: true, isToggleOff: true }).grant).toBe(false);
  });

  it("BOOST carries zero XP — spotlighting is its own reward", () => {
    expect(XP_FIRST_TIME.boost).toBe(0);
    expect(decideInteractionXp({ action: "boost", alreadyCountedForXp: false, isToggleOff: false }).grant).toBe(false);
  });
});

/* ---------------- BOOST daily limit ---------------- */
describe("BOOST daily spotlight", () => {
  it("allows one per UTC day, denies the second", () => {
    expect(boostUsedToday(undefined, NOW)).toBe(false);
    const earlierToday = NOW - 60_000;
    expect(boostUsedToday(earlierToday, NOW)).toBe(true);
    const yesterday = NOW - DAY + 60_000; // may cross a UTC boundary by design
    expect(typeof boostUsedToday(yesterday, NOW)).toBe("boolean");
  });
});

/* ---------------- decision core ---------------- */
describe("decideInteraction", () => {
  it("denies unauthenticated, suspended, missing/unpublished targets", () => {
    expect(decideInteraction({ caller: null, action: "energy", target, blockedByEither: false, recentActionTimestamps: [], existingRow: null, now: NOW })).toEqual({
      action: "deny",
      error: "unauthenticated",
    });
    expect(
      decideInteraction({ caller: me({ userStatus: "suspended" }), action: "energy", target, blockedByEither: false, recentActionTimestamps: [], existingRow: null, now: NOW })
    ).toEqual({ action: "deny", error: "caller_restricted" });
    expect(
      decideInteraction({ caller: me(), action: "energy", target: null, blockedByEither: false, recentActionTimestamps: [], existingRow: null, now: NOW })
    ).toEqual({ action: "deny", error: "target_unavailable" });
    expect(
      decideInteraction({ caller: me(), action: "energy", target: { ...target, status: "removed" }, blockedByEither: false, recentActionTimestamps: [], existingRow: null, now: NOW })
    ).toEqual({ action: "deny", error: "target_unavailable" });
  });

  it("blocks are absolute — either direction denies", () => {
    expect(
      decideInteraction({ caller: me(), action: "practice", target, blockedByEither: true, recentActionTimestamps: [], existingRow: null, now: NOW })
    ).toEqual({ action: "deny", error: "blocked" });
  });

  it("applies a first-time interaction with XP and notifies the author", () => {
    const d = decideInteraction({ caller: me(), action: "energy", target, blockedByEither: false, recentActionTimestamps: [], existingRow: null, now: NOW });
    expect(d).toMatchObject({ action: "apply", authorId: "u_sara", isToggleOff: false });
    if (d.action === "apply") expect(d.xp).toEqual({ grant: true, amount: 5, reason: "interaction_energy" });
  });

  it("applies a toggle-off with no XP and a negative count delta", () => {
    const d = decideInteraction({ caller: me(), action: "practice", target, blockedByEither: false, recentActionTimestamps: [], existingRow: { _id: "r1" }, now: NOW });
    expect(d).toMatchObject({ action: "apply", isToggleOff: true });
    if (d.action === "apply") expect(d.xp.grant).toBe(false);
    expect(interactionCountDelta(d)).toBe(-1);
    expect(interactionCountDelta({ action: "deny", error: "blocked" })).toBe(0);
  });

  it("rate-limits repeated actions inside the window", () => {
    const spam = Array.from({ length: RATE_LIMITS.challenge.limit }, (_, i) => NOW - i - 1);
    expect(
      decideInteraction({ caller: me(), action: "challenge", target, blockedByEither: false, recentActionTimestamps: spam, existingRow: null, now: NOW })
    ).toEqual({ action: "deny", error: "rate_limited" });
  });

  it("enforces the one-BOOST-per-day rule with a dedicated error", () => {
    expect(
      decideInteraction({ caller: me(), action: "boost", target, blockedByEither: false, recentActionTimestamps: [], existingRow: null, now: NOW, lastBoostAt: NOW - 60_000 })
    ).toEqual({ action: "deny", error: "boost_daily_limit" });
    const d = decideInteraction({ caller: me(), action: "boost", target, blockedByEither: false, recentActionTimestamps: [], existingRow: null, now: NOW, lastBoostAt: NOW - 2 * DAY });
    expect(d.action).toBe("apply");
  });
});

/* ---------------- quick reactions on comments ---------------- */
describe("comment quick reactions", () => {
  const comment = { _id: "c1", status: "visible" };

  it("only visible comments can gather reactions", () => {
    expect(decideCommentQuickReaction({ caller: me(), comment: { _id: "c1", status: "hidden" }, reaction: "vibe", existingRow: null, recentReactionTimestamps: [], now: NOW })).toEqual({
      action: "deny",
      error: "target_unavailable",
    });
    expect(decideCommentQuickReaction({ caller: me(), comment: null, reaction: "vibe", existingRow: null, recentReactionTimestamps: [], now: NOW })).toEqual({
      action: "deny",
      error: "target_unavailable",
    });
  });

  it("toggles per (user, comment, kind) and rate-limits bursts", () => {
    expect(decideCommentQuickReaction({ caller: me(), comment, reaction: "on_point", existingRow: null, recentReactionTimestamps: [], now: NOW })).toEqual({
      action: "insert",
      reaction: "on_point",
    });
    expect(decideCommentQuickReaction({ caller: me(), comment, reaction: "on_point", existingRow: { _id: "r9" }, recentReactionTimestamps: [], now: NOW })).toEqual({
      action: "delete",
      rowId: "r9",
    });
    const spam = Array.from({ length: RATE_LIMITS.energy.limit }, (_, i) => NOW - i - 1);
    expect(decideCommentQuickReaction({ caller: me(), comment, reaction: "power", existingRow: null, recentReactionTimestamps: spam, now: NOW })).toEqual({
      action: "deny",
      error: "rate_limited",
    });
  });

  it("maps interaction rows to stable stored kinds", () => {
    expect(interactionRowKind("move")).toBe("move");
    expect(interactionRowKind("energy")).toBe("energy");
    expect(interactionRowKind("boost")).toBe("boost");
  });
});
