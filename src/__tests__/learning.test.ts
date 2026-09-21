/**
 * Day 7 — DENSEN LEARN core tests.
 * Pins the learning decision rules: idempotent completion (never double XP),
 * the FREE/PAID/CREDITS/PAID+CREDITS access ladder, the €2–€30 price band,
 * and client↔server vocabulary parity (categories, content types, access
 * model derivation).
 */
import { describe, expect, it } from "vitest";
import {
  accessModelOf,
  courseProgressPct,
  decideClassAccess,
  decideCompletion,
  isCourseComplete,
  LEARN_CATEGORIES,
  CONTENT_TYPES,
  validateClassPricing,
  type ClassPricing,
} from "../../convex/learning";
// Client mirror — the import also proves the module compiles standalone.
import { accessModelOf as clientAccessModelOf, CLASS_PRICING } from "../data/learning";

const caller = { userId: "u1", userStatus: "active" };
const lesson = { status: "published", xpReward: 150 };

describe("decideCompletion (lesson progress + completion)", () => {
  it("completes the first time and pays XP", () => {
    const d = decideCompletion({ caller, lesson, existing: null });
    expect(d).toEqual({ action: "complete", xpGranted: 150, alreadyCompleted: false });
  });

  it("is idempotent: the second completion grants ZERO XP", () => {
    const d = decideCompletion({
      caller,
      lesson,
      existing: { touchedPhases: ["watch", "complete"], completedAt: 123 },
    });
    expect(d).toEqual({ action: "complete", xpGranted: 0, alreadyCompleted: true });
  });

  it("denies guests, suspended callers and unpublished lessons", () => {
    expect(decideCompletion({ caller: null, lesson, existing: null })).toEqual({
      action: "deny",
      error: "unauthenticated",
    });
    expect(
      decideCompletion({ caller: { userId: "u1", userStatus: "suspended" }, lesson, existing: null })
    ).toEqual({ action: "deny", error: "caller_restricted" });
    expect(decideCompletion({ caller, lesson: null, existing: null })).toEqual({
      action: "deny",
      error: "lesson_unavailable",
    });
    expect(
      decideCompletion({ caller, lesson: { status: "in_review", xpReward: 150 }, existing: null })
    ).toEqual({ action: "deny", error: "lesson_unavailable" });
  });

  it("there is no uncomplete — the toggle farm loop cannot exist", () => {
    // completing 3 times: only the first pays
    let existing: import("../../convex/learning").ProgressState | null = null;
    const grants: number[] = [];
    for (let i = 0; i < 3; i++) {
      const d = decideCompletion({ caller, lesson, existing });
      if (d.action === "complete") {
        grants.push(d.xpGranted);
        existing = { touchedPhases: ["complete"], completedAt: i + 1 } as const;
      }
    }
    expect(grants).toEqual([150, 0, 0]);
  });
});

describe("courseProgressPct / isCourseComplete", () => {
  const lessons = [{ position: 1 }, { position: 2 }, { position: 3 }, { position: 4 }];

  it("computes percentage from completed positions", () => {
    expect(courseProgressPct(lessons, [])).toBe(0);
    expect(
      courseProgressPct(lessons, [
        { position: 1, completedAt: 1 },
        { position: 2, completedAt: 2 },
      ])
    ).toBe(50);
    expect(
      courseProgressPct(lessons, lessons.map((l) => ({ position: l.position, completedAt: 1 })))
    ).toBe(100);
  });

  it("isCourseComplete requires every lesson done and non-empty catalog", () => {
    expect(isCourseComplete(lessons, [])).toBe(false);
    expect(
      isCourseComplete(lessons, lessons.map((l) => ({ position: l.position, completedAt: 1 })))
    ).toBe(true);
    expect(isCourseComplete([], [{ position: 1, completedAt: 1 }])).toBe(false);
  });
});

describe("pricing ladder (FREE / PAID / CREDITS / PAID+CREDITS)", () => {
  const cases: [ClassPricing, string][] = [
    [{ accessModel: "free", priceCents: 0, creditPrice: 0 }, "free"],
    [{ accessModel: "paid", priceCents: 800, creditPrice: 0 }, "paid"],
    [{ accessModel: "credits", priceCents: 0, creditPrice: 60 }, "credits"],
    [{ accessModel: "paid_credits", priceCents: 800, creditPrice: 80 }, "paid_credits"],
  ];
  it.each(cases)("derives %s from the pricing row", (row, expected) => {
    expect(accessModelOf(row)).toBe(expected);
  });

  it("client mirror derives identically (parity)", () => {
    for (const [row] of cases) expect(clientAccessModelOf(row)).toBe(accessModelOf(row));
  });

  it("enforces the €2–€30 band for paid classes", () => {
    expect(validateClassPricing({ accessModel: "paid", priceCents: 200, creditPrice: 0 }).ok).toBe(true); // €2
    expect(validateClassPricing({ accessModel: "paid", priceCents: 3000, creditPrice: 0 }).ok).toBe(true); // €30
    expect(validateClassPricing({ accessModel: "paid", priceCents: 199, creditPrice: 0 })).toEqual({
      ok: false,
      error: "price_out_of_range",
    });
    expect(validateClassPricing({ accessModel: "paid", priceCents: 3001, creditPrice: 0 })).toEqual({
      ok: false,
      error: "price_out_of_range",
    });
    // The declared model must match the numbers — "free" with a price is a lie.
    expect(validateClassPricing({ accessModel: "free", priceCents: 500, creditPrice: 0 })).toEqual({
      ok: false,
      error: "access_model_mismatch",
    });
  });

  it("decides class access", () => {
    const free: ClassPricing = { accessModel: "free", priceCents: 0, creditPrice: 0 };
    expect(decideClassAccess({ caller: null, pricing: free, creditBalance: 0, alreadyOwned: false })).toEqual({
      allowed: true,
    });
    const paid: ClassPricing = { accessModel: "paid", priceCents: 800, creditPrice: 0 };
    expect(decideClassAccess({ caller: null, pricing: paid, creditBalance: 0, alreadyOwned: false })).toEqual({
      allowed: false,
      error: "unauthenticated",
    });
    expect(
      decideClassAccess({ caller, pricing: paid, creditBalance: 999, alreadyOwned: false })
    ).toEqual({ allowed: false, error: "payment_required" }); // no fake payments
    const credits: ClassPricing = { accessModel: "credits", priceCents: 0, creditPrice: 60 };
    expect(
      decideClassAccess({ caller, pricing: credits, creditBalance: 59, alreadyOwned: false })
    ).toEqual({ allowed: false, error: "insufficient_credits" });
    expect(decideClassAccess({ caller, pricing: credits, creditBalance: 60, alreadyOwned: false })).toEqual({
      allowed: true,
    }); // credits are real ledger money — unlockable today
    expect(decideClassAccess({ caller: null, pricing: paid, creditBalance: 0, alreadyOwned: true })).toEqual({
      allowed: true,
    }); // owned beats everything
  });

  it("every catalog pricing row is valid and mirrors the server ladder", () => {
    for (const [, row] of Object.entries(CLASS_PRICING)) {
      expect(validateClassPricing(row).ok).toBe(true);
      expect(accessModelOf(row)).toBe(row.accessModel);
    }
  });
});

describe("catalog vocabulary (server ↔ client)", () => {
  it("server categories cover the Day 7 brief exactly", () => {
    expect([...LEARN_CATEGORIES]).toEqual([
      "Beginner",
      "Hip-Hop",
      "Commercial",
      "Contemporary",
      "Jazz",
      "Latin",
      "Kids",
      "Teens",
      "Advanced",
      "Professional",
    ]);
  });

  it("content types are the six brief types", () => {
    expect([...CONTENT_TYPES]).toEqual(["move", "combo", "choreography", "class", "course", "lesson"]);
  });
});
