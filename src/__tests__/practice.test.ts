/**
 * Day 12 — pure practice core tests.
 * The wire module applies these decisions inside Convex transactions.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STEPS,
  PRACTICE_COMPLETION_XP,
  SESSION_MIN_SECONDS,
  decideComplete,
  decideSession,
  isStepListComplete,
  progressOf,
  sanitizeRef,
  sortForDisplay,
  stepsFromPlan,
  summarize,
  toggleStep,
  type PracticeItemView,
} from "../../convex/practice";

const NOW = 1_700_000_000_000;

describe("progress math", () => {
  const plan = stepsFromPlan(DEFAULT_STEPS.combo); // 5 steps

  it("starts at 0% and counts done/applicable steps", () => {
    expect(progressOf(plan)).toEqual({ pct: 0, doneCount: 0, total: 5 });
    const half = plan.map((s, i) => (i < 3 ? { ...s, done: true } : s));
    expect(progressOf(half)).toEqual({ pct: 60, doneCount: 3, total: 5 });
  });

  it("skipped steps (undefined) do not count against completion", () => {
    const steps = [
      { label: "a", done: true },
      { label: "b", done: undefined },
      { label: "c", done: true },
      { label: "d", done: true },
      { label: "e", done: true },
    ];
    expect(progressOf(steps)).toEqual({ pct: 100, doneCount: 4, total: 4 });
    expect(isStepListComplete(steps)).toBe(true);
  });

  it("toggles one step and auto-completes at 100%", () => {
    let steps = plan;
    for (let i = 0; i < plan.length - 1; i++) steps = toggleStep(steps, i);
    expect(progressOf(steps).pct).toBe(80);
    expect(isStepListComplete(steps)).toBe(false);
    steps = toggleStep(steps, 4);
    expect(isStepListComplete(steps)).toBe(true);
    // toggling an out-of-range index is a no-op
    expect(toggleStep(steps, 9)).toEqual(steps);
  });

  it("completing twice keeps progress at 100 (no regression from re-toggles)", () => {
    let steps = plan;
    for (let i = 0; i < plan.length; i++) steps = toggleStep(steps, i);
    steps = toggleStep(steps, 0); // user un-checks after completion
    expect(progressOf(steps).pct).toBe(80);
    // but the completion payment is ledger-gated regardless — see decideComplete
  });
});

describe("session rules", () => {
  it("rejects short/absurd sessions and guests", () => {
    expect(decideSession({ signedIn: true, seconds: 30 })).toEqual({ action: "deny", error: "too_short" });
    expect(decideSession({ signedIn: true, seconds: 5 * 3600 })).toEqual({ action: "deny", error: "too_long" });
    expect(decideSession({ signedIn: false, seconds: 600 })).toEqual({ action: "deny", error: "unauthenticated" });
    expect(decideSession({ signedIn: true, seconds: SESSION_MIN_SECONDS })).toEqual({ action: "record", paid: true });
  });
});

describe("completion rules", () => {
  const doneSteps = stepsFromPlan(DEFAULT_STEPS.combo).map((s) => ({ ...s, done: true as const }));

  it("pays kind-specific XP once, then denies forever", () => {
    const res = decideComplete({
      signedIn: true,
      item: { userId: "me" },
      callerUserId: "me",
      alreadyPaid: false,
      steps: doneSteps,
      kind: "choreography",
    });
    expect(res).toEqual({ action: "complete", xp: PRACTICE_COMPLETION_XP.choreography, creditSource: "choreography_complete" });

    // ledger probe wins — no re-pay
    expect(
      decideComplete({ signedIn: true, item: { userId: "me" }, callerUserId: "me", alreadyPaid: true, steps: doneSteps, kind: "choreography" })
    ).toEqual({ action: "deny", error: "already_completed" });

    // item flag double-lock
    expect(
      decideComplete({ signedIn: true, item: { userId: "me", completedAt: NOW }, callerUserId: "me", alreadyPaid: false, steps: doneSteps, kind: "choreography" })
    ).toEqual({ action: "deny", error: "already_completed" });
  });

  it("never completes without every applicable step done", () => {
    const partial = stepsFromPlan(DEFAULT_STEPS.combo).map((s, i) => (i < 3 ? { ...s, done: true as const } : s));
    expect(
      decideComplete({ signedIn: true, item: { userId: "me" }, callerUserId: "me", alreadyPaid: false, steps: partial, kind: "combo" })
    ).toEqual({ action: "deny", error: "steps_incomplete" });
  });

  it("gates on ownership and existence", () => {
    expect(
      decideComplete({ signedIn: true, item: { userId: "other" }, callerUserId: "me", alreadyPaid: false, steps: doneSteps, kind: "combo" })
    ).toEqual({ action: "deny", error: "not_own" });
    expect(
      decideComplete({ signedIn: true, item: null, callerUserId: "me", alreadyPaid: false, steps: doneSteps, kind: "combo" })
    ).toEqual({ action: "deny", error: "not_found" });
  });

  it("moves pay XP only (no credits)", () => {
    const res = decideComplete({
      signedIn: true,
      item: { userId: "me" },
      callerUserId: "me",
      alreadyPaid: false,
      steps: stepsFromPlan(DEFAULT_STEPS.move).map((s) => ({ ...s, done: true as const })),
      kind: "move",
    });
    expect(res).toEqual({ action: "complete", xp: PRACTICE_COMPLETION_XP.move, creditSource: undefined });
  });
});

describe("compare + projection helpers", () => {
  it("sanitizes media refs (opaque, non-empty, bounded)", () => {
    expect(sanitizeRef("media://abc123")).toBe("media://abc123");
    expect(sanitizeRef("   ")).toBeUndefined();
    expect(sanitizeRef("x".repeat(300))).toBeUndefined();
    expect(sanitizeRef(42)).toBeUndefined();
  });

  it("sorts in-progress first by recency, completed last", () => {
    const items = [
      { id: "done-old", completedAt: NOW, lastPracticedAt: NOW - 5000, createdAt: NOW },
      { id: "active-recent", lastPracticedAt: NOW - 1000, createdAt: NOW },
      { id: "active-old", lastPracticedAt: NOW - 9000, createdAt: NOW },
    ] as unknown as PracticeItemView[];
    expect(sortForDisplay(items).map((i) => i.id)).toEqual(["active-recent", "active-old", "done-old"]);
  });

  it("summarizes the workspace", () => {
    const items = [
      { progress: { pct: 100, doneCount: 2, total: 2 }, completedAt: NOW, totalSeconds: 600 },
      { progress: { pct: 50, doneCount: 1, total: 2 }, totalSeconds: 300 },
    ] as unknown as PracticeItemView[];
    expect(summarize(items)).toEqual({ total: 2, active: 1, completed: 1, totalSeconds: 900, avgProgressPct: 75 });
  });
});
