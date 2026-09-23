/**
 * Day 11 — pure cores for Challenges + Achievements.
 * The wire modules apply these decisions inside Convex transactions.
 */
import { describe, expect, it } from "vitest";
import {
  daysLeftOf,
  decideComplete,
  decideJoin,
  decideSubmit,
  phaseOf,
} from "../../convex/challenges";
import {
  ACHIEVEMENTS,
  ZERO_STATS,
  decideAward,
  progressPct,
  qualifying,
} from "../../convex/achievements";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const PUB = { status: "published" };
const STUDIO_PUB = { status: "draft", studioStatus: "published" };

describe("challenge phase", () => {
  it("derives upcoming/active/ended from the time window", () => {
    expect(phaseOf({ startsAt: NOW + 1000 }, NOW)).toBe("upcoming");
    expect(phaseOf({ startsAt: NOW - 1000, deadlineAt: NOW + DAY }, NOW)).toBe("active");
    expect(phaseOf({ deadlineAt: NOW - 1 }, NOW)).toBe("ended");
    expect(phaseOf({}, NOW)).toBe("active"); // undated = always open
  });

  it("counts days left, clamped at 0", () => {
    expect(daysLeftOf(NOW + 3 * DAY + 1, NOW)).toBe(4); // ceil
    expect(daysLeftOf(NOW - DAY, NOW)).toBe(0);
    expect(daysLeftOf(undefined, NOW)).toBe(0);
  });
});

describe("join decision", () => {
  it("denies guests, missing/unpublished challenges, closed windows and re-joins", () => {
    expect(decideJoin({ signedIn: false, challenge: PUB, alreadyJoined: false, phase: "active" })).toEqual({
      action: "deny",
      error: "unauthenticated",
    });
    expect(decideJoin({ signedIn: true, challenge: null, alreadyJoined: false, phase: "active" })).toEqual({
      action: "deny",
      error: "not_found",
    });
    expect(decideJoin({ signedIn: true, challenge: { status: "draft" }, alreadyJoined: false, phase: "active" })).toEqual({
      action: "deny",
      error: "not_published",
    });
    expect(decideJoin({ signedIn: true, challenge: PUB, alreadyJoined: false, phase: "upcoming" })).toEqual({
      action: "deny",
      error: "not_active",
    });
    expect(decideJoin({ signedIn: true, challenge: PUB, alreadyJoined: true, phase: "active" })).toEqual({
      action: "deny",
      error: "already_joined",
    });
  });

  it("allows a signed-in first join on an active published challenge", () => {
    expect(decideJoin({ signedIn: true, challenge: PUB, alreadyJoined: false, phase: "active" })).toEqual({
      action: "join",
    });
    // studio-published rows are public too
    expect(decideJoin({ signedIn: true, challenge: STUDIO_PUB, alreadyJoined: false, phase: "active" })).toEqual({
      action: "join",
    });
  });
});

describe("submit decision", () => {
  const base = {
    signedIn: true,
    challenge: PUB,
    joined: true,
    phase: "active" as const,
    post: { userId: "me", status: "published" },
    callerUserId: "me",
    alreadySubmitted: false,
  };

  it("requires join, active window, ownership and a published post", () => {
    expect(decideSubmit({ ...base, joined: false })).toEqual({ action: "deny", error: "not_joined" });
    expect(decideSubmit({ ...base, phase: "ended" })).toEqual({ action: "deny", error: "not_active" });
    expect(decideSubmit({ ...base, post: { userId: "other", status: "published" } })).toEqual({
      action: "deny",
      error: "post_not_own",
    });
    expect(decideSubmit({ ...base, post: { userId: "me", status: "pending_review" } })).toEqual({
      action: "deny",
      error: "post_not_published",
    });
    expect(decideSubmit({ ...base, post: null })).toEqual({ action: "deny", error: "post_not_found" });
    expect(decideSubmit({ ...base, alreadySubmitted: true })).toEqual({
      action: "deny",
      error: "already_submitted",
    });
    expect(decideSubmit(base)).toEqual({ action: "submit" });
  });
});

describe("complete decision", () => {
  const base = {
    signedIn: true,
    challenge: { ...PUB, reward: { xp: 300, credits: 3, badgeCode: "denfest_25" } },
    joined: true,
    phase: "ended" as const,
    submission: { status: "cleared" },
    alreadyPaid: false,
  };

  it("pays the challenge-defined rewards exactly once", () => {
    expect(decideComplete(base)).toEqual({
      action: "complete",
      xp: 300,
      credits: 3,
      badgeCode: "denfest_25",
    });
    // ledger probe wins — no re-pay
    expect(decideComplete({ ...base, alreadyPaid: true })).toEqual({
      action: "deny",
      error: "already_completed",
    });
  });

  it("falls back to configured defaults when no reward defined", () => {
    const out = decideComplete({ ...base, challenge: { ...PUB } });
    expect(out).toEqual({ action: "complete", xp: 250, credits: 2 });
  });

  it("never completes without a CLEARED submission", () => {
    expect(decideComplete({ ...base, submission: { status: "pending" } })).toEqual({
      action: "deny",
      error: "no_cleared_submission",
    });
    expect(decideComplete({ ...base, submission: { status: "rejected" } })).toEqual({
      action: "deny",
      error: "no_cleared_submission",
    });
    expect(decideComplete({ ...base, submission: null })).toEqual({
      action: "deny",
      error: "no_cleared_submission",
    });
  });

  it("gates on join + window end", () => {
    expect(decideComplete({ ...base, joined: false })).toEqual({ action: "deny", error: "not_joined" });
    expect(decideComplete({ ...base, phase: "active" })).toEqual({ action: "deny", error: "not_ended" });
  });
});

describe("achievements catalog + evaluation", () => {
  it("has the Day 11 codes", () => {
    const codes = ACHIEVEMENTS.map((a) => a.code);
    for (const c of [
      "first_step",
      "seven_day_dancer",
      "on_beat",
      "combo_machine",
      "creator",
      "choreographer",
      "consistent",
      "challenger",
      "rising_dancer",
    ]) {
      expect(codes).toContain(c);
    }
    // codes unique
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("awards exactly when server stats meet the threshold", () => {
    const def = ACHIEVEMENTS.find((a) => a.code === "first_step")!;
    expect(decideAward({ def, stats: { ...ZERO_STATS }, alreadyOwned: false })).toEqual({
      action: "deny",
      error: "requirements_not_met",
    });
    expect(decideAward({ def, stats: { ...ZERO_STATS, lessons: 1 }, alreadyOwned: false })).toEqual({
      action: "award",
      xp: def.xpReward,
    });
    // ownership probe wins — duplicate awards structurally impossible
    expect(decideAward({ def, stats: { ...ZERO_STATS, lessons: 5 }, alreadyOwned: true })).toEqual({
      action: "deny",
      error: "already_owned",
    });
    expect(decideAward({ def: undefined, stats: ZERO_STATS, alreadyOwned: false })).toEqual({
      action: "deny",
      error: "unknown_code",
    });
  });

  it("progress is clamped 0-100", () => {
    const def = ACHIEVEMENTS.find((a) => a.code === "consistent")!; // 30-day streak
    expect(progressPct(def, { ...ZERO_STATS })).toBe(0);
    expect(progressPct(def, { ...ZERO_STATS, streakBest: 15 })).toBe(50);
    expect(progressPct(def, { ...ZERO_STATS, streakBest: 45 })).toBe(100);
  });

  it("lists only currently-qualified achievements", () => {
    const got = qualifying(ACHIEVEMENTS, { ...ZERO_STATS, lessons: 1, streakBest: 7 });
    expect(got.map((a) => a.code).sort()).toEqual(["first_step", "on_beat", "seven_day_dancer"]);
  });
});
