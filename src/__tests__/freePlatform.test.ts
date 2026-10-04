/**
 * Day 23 — FREE PLATFORM regression guard.
 * ========================================
 * Pins the product decision "Densen Academy is completely free":
 *
 *  1. NO active purchase flow may exist in the app surface — no UI file may
 *     reference the removed payment/credit-purchase functions (checkout,
 *     spend-to-unlock, purchase ledger, refund requests). This is a static
 *     guard: reintroducing a paywall must consciously delete this test.
 *  2. Mode gating: the mode preference can never outrank the server role —
 *     dancers (and guests) always render Dancer Mode.
 *  3. Practice player logic: the four dance speeds, time formatting, the
 *     A–B section repeat state machine, and per-lesson speed memory.
 *  4. Teacher timestamps flow from server rows into seekable lesson moves.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  clampSpeed,
  emptyAB,
  formatTime,
  loadLessonSpeed,
  reduceAB,
  saveLessonSpeed,
  sectionStart,
  shouldLoopToA,
  PLAYBACK_SPEEDS,
} from "../lib/practicePlayer";
import { canTeach, effectiveMode, modeDeferred } from "../lib/mode";
import { pricingFromRow } from "../data/serverCatalog";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------------- 1. no active purchase flow in the app surface ---------------- */

/**
 * Every app-surface source file as raw text (Vite glob — no node imports).
 * A paywall reintroduction must consciously delete this guard.
 */
const SURFACE_SOURCES = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Lazy (non-evaluated) keys for the deleted backend wires — empty when gone. */
const REMOVED_WIRES = import.meta.glob("/convex/{paymentsWire,paymentProvider}.ts");

const FORBIDDEN_FLOW_PATTERNS: RegExp[] = [
  /api\.paymentsWire\./, // the removed payment wire surface
  /creditsWire\.spendCredits/, // credit-purchase path
  /spendCredits\(/,
  /startPurchase\(/,
  /adminRefundQueue/,
  /listMyPurchases\(/,
  /requestRefund\(/,
  /setCheckout\(/,
  /\bbuyCourse\(/,
];

describe("Day 23 — no active purchase/paywall flow remains", () => {
  it("app surface files contain zero references to payment/credit-purchase flows", () => {
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(SURFACE_SOURCES)) {
      if (file.includes("__tests__")) continue; // this guard itself quotes the patterns
      for (const re of FORBIDDEN_FLOW_PATTERNS) {
        if (re.test(text)) offenders.push(`${file}: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the removed payment backend wires are really gone from the source tree", () => {
    expect(Object.keys(REMOVED_WIRES)).toEqual([]);
  });

  it("published lessons are free: the catalog adapter never reports a paid access model", () => {
    for (const row of [
      { priceCents: 0, creditPrice: 0 },
      { priceCents: 800, creditPrice: 0 },
      { priceCents: 0, creditPrice: 60 },
      { priceCents: 3000, creditPrice: 500 },
    ]) {
      expect(pricingFromRow(row).accessModel).toBe("free");
    }
  });
});

/* ---------------- 2. mode gating ---------------- */

const teacherViewer = { role: "teacher" };
const adminViewer = { role: "admin" };
const dancerViewer = { role: "user" };

describe("Day 23 — Dancer/Teacher mode gating", () => {
  it("verified teachers and admins may teach", () => {
    expect(canTeach(teacherViewer)).toBe(true);
    expect(canTeach(adminViewer)).toBe(true);
  });

  it("dancers, guests and moderators may not", () => {
    expect(canTeach(dancerViewer)).toBe(false);
    expect(canTeach(null)).toBe(false);
    expect(canTeach(undefined)).toBe(false);
    expect(canTeach({ role: "moderator" })).toBe(false);
  });

  it("a teacher preference only takes effect for verified teachers", () => {
    expect(effectiveMode("teacher", teacherViewer)).toBe("teacher");
    expect(effectiveMode("teacher", adminViewer)).toBe("teacher");
    expect(effectiveMode("teacher", dancerViewer)).toBe("dancer");
    expect(effectiveMode("teacher", null)).toBe("dancer");
    expect(effectiveMode("dancer", teacherViewer)).toBe("dancer");
  });

  it("a deferred teacher preference is remembered, never dropped", () => {
    expect(modeDeferred("teacher", dancerViewer)).toBe(true);
    expect(modeDeferred("teacher", teacherViewer)).toBe(false);
    expect(modeDeferred("dancer", dancerViewer)).toBe(false);
  });

  it("Teacher Mode never grants admin: the role set is closed", () => {
    expect(effectiveMode("teacher", { role: "admin" })).toBe("teacher"); // admins may use it…
    expect(canTeach({ role: "teacher" })).toBe(true);
    // …but no mode value itself elevates a role: gating reads ONLY the role.
    expect(effectiveMode("teacher", {})).toBe("dancer");
  });
});

/* ---------------- 3. practice player logic ---------------- */

describe("Day 23 — playback speeds", () => {
  it("exposes exactly the four dance speeds", () => {
    expect([...PLAYBACK_SPEEDS]).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("clamps arbitrary values onto the supported set", () => {
    expect(clampSpeed(0.25)).toBe(0.25);
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(2)).toBe(1);
    expect(clampSpeed(0)).toBe(1);
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed(NaN)).toBe(1);
  });
});

describe("Day 23 — time formatting", () => {
  it("formats seconds as m:ss (and h:mm:ss past one hour)", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(62.4)).toBe("1:02");
    expect(formatTime(3599)).toBe("59:59");
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3723)).toBe("1:02:03");
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(undefined)).toBe("0:00");
  });
});

describe("Day 23 — A–B section repeat", () => {
  it("arms A then B only with a positive span", () => {
    let m = reduceAB(emptyAB, { type: "setA", at: 10 });
    expect(m).toEqual({ a: 10, b: null });
    m = reduceAB(m, { type: "setB", at: 4 }); // B before A → rejected
    expect(m.b).toBe(null);
    m = reduceAB(m, { type: "setB", at: 20 });
    expect(m).toEqual({ a: 10, b: 20 });
  });

  it("negative A clamps to zero; moving A past B clears B", () => {
    let m = reduceAB(emptyAB, { type: "setA", at: -3 });
    expect(m.a).toBe(0);
    m = reduceAB(m, { type: "setB", at: 15 });
    m = reduceAB(m, { type: "setA", at: 16 });
    expect(m).toEqual({ a: 16, b: null });
  });

  it("clear resets both markers", () => {
    let m = reduceAB(reduceAB(emptyAB, { type: "setA", at: 2 }), { type: "setB", at: 9 });
    m = reduceAB(m, { type: "clear" });
    expect(m).toEqual({ a: null, b: null });
  });

  it("loops to A exactly when the playhead crosses B", () => {
    const m = reduceAB(reduceAB(emptyAB, { type: "setA", at: 5 }), { type: "setB", at: 12 });
    expect(shouldLoopToA(m, 12.2, 11.9)).toBe(true);
    expect(shouldLoopToA(m, 11.9, 11.8)).toBe(false);
    expect(shouldLoopToA(m, 30, 29.9)).toBe(false); // passed B long ago (e.g. user seeked)
    expect(shouldLoopToA(emptyAB, 12.2, 11.9)).toBe(false);
  });

  it("section start falls back to 0 without an A marker", () => {
    expect(sectionStart(emptyAB)).toBe(0);
    expect(sectionStart({ a: 7, b: null })).toBe(7);
  });
});

/* ---------------- 4. per-lesson speed memory ---------------- */

const memoryStore = new Map<string, string>();
const localStub = {
  getItem: (k: string) => memoryStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memoryStore.set(k, v),
  removeItem: (k: string) => void memoryStore.delete(k),
  clear: () => memoryStore.clear(),
};

describe("Day 23 — speed memory is per lesson (never feed-wide)", () => {
  beforeEach(() => {
    memoryStore.clear();
    vi.stubGlobal("localStorage", localStub);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("each lesson remembers its own practice speed", () => {
    expect(loadLessonSpeed("lesson_A")).toBe(1);
    saveLessonSpeed("lesson_A", 0.25);
    saveLessonSpeed("lesson_B", 0.75);
    expect(loadLessonSpeed("lesson_A")).toBe(0.25);
    expect(loadLessonSpeed("lesson_B")).toBe(0.75);
    expect(loadLessonSpeed("lesson_C")).toBe(1); // untouched lesson stays normal
  });

  it("returning a lesson to 1× clears the stored override", () => {
    saveLessonSpeed("lesson_A", 0.5);
    expect(loadLessonSpeed("lesson_A")).toBe(0.5);
    saveLessonSpeed("lesson_A", 1);
    expect(loadLessonSpeed("lesson_A")).toBe(1);
  });

  it("missing storage degrades gracefully", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadLessonSpeed("lesson_A")).toBe(1);
    expect(() => saveLessonSpeed("lesson_A", 0.5)).not.toThrow();
  });
});

/* ---------------- 5. teacher timestamps → seekable moves ---------------- */

describe("Day 23 — teacher timestamps become seekable lesson moves", () => {
  it("steps with atSec carry a timestamp label and the seek target", async () => {
    const { serverClassToCourse } = (await import("../data/serverCatalog")) as any;
    const c = serverClassToCourse({
      id: "kx1a2b3c4d5e6f7g8h",
      kind: "class",
      title: "Slow-motion basics",
      description: "Take it slow.",
      style: "Hip-Hop",
      difficulty: "beginner",
      coverUrl: "",
      durationSec: 600,
      priceCents: 0,
      creditPrice: 0,
      videoUrl: "https://storage.example.com/lesson.mp4",
      steps: [
        { label: "Opening pose", atSec: 0 },
        { label: "Shoulder pop", atSec: 34 },
      ],
      createdAt: 1,
      teacher: { id: "u_t", handle: "t", displayName: "T", verified: true },
    });
    expect(c.lessons[0].video).toBe("https://storage.example.com/lesson.mp4");
    expect(c.lessons[0].moves).toHaveLength(2);
    expect(c.lessons[0].moves[1]).toMatchObject({ name: "Shoulder pop", atSec: 34 });
    expect(typeof c.lessons[0].moves[1].timing).toBe("string");
  });
});
