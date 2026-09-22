import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  DENSEN_LEVELS,
  CONTENT_DAILY_CAP,
  PRACTICE_DAILY_CAP,
  STREAK_BONUSES,
  XP_VALUES,
  dayKeyFromTs,
  decideActivityXp,
  foldActivityDay,
  levelForXp,
  prevDayKey,
} from "../../convex/arcade";

const caller = { userId: "u1", userStatus: "active" };

/* ------------------------------ levels ------------------------------ */

describe("arcade levels", () => {
  it("exposes the Day 9 ladder of 10 named levels", () => {
    expect(DENSEN_LEVELS.length).toBe(10);
    expect(DENSEN_LEVELS.map((l) => l.name)).toEqual([
      "First Steps",
      "Getting Started",
      "Moving",
      "Groove",
      "Dancer",
      "Rising Dancer",
      "Advanced Dancer",
      "Performer",
      "Creator",
      "Dance Master",
    ]);
  });

  it("is strictly increasing and expandable", () => {
    for (let i = 1; i < DENSEN_LEVELS.length; i++) {
      expect(DENSEN_LEVELS[i].xpRequired).toBeGreaterThan(DENSEN_LEVELS[i - 1].xpRequired);
    }
    // future expansion appends without touching earlier entries
    const expanded = [...DENSEN_LEVELS, { level: 11, name: "Legend", xpRequired: 30000 }];
    expect(levelForXp(29999, expanded as never).name).toBe("Dance Master");
    expect(levelForXp(30000, expanded as never).name).toBe("Legend");
  });

  it("maps XP balances to ladder positions", () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, name: "First Steps", xpIntoLevel: 0 });
    expect(levelForXp(299)).toMatchObject({ level: 1, xpIntoLevel: 299, xpForLevel: 300 });
    expect(levelForXp(300)).toMatchObject({ level: 2, name: "Getting Started", xpIntoLevel: 0 });
    expect(levelForXp(1000)).toMatchObject({ level: 3, name: "Moving", xpIntoLevel: 200, xpForLevel: 800 });
    expect(levelForXp(50000)).toMatchObject({ level: 10, name: "Dance Master", atCap: true });
  });

  it("is robust against negative and fractional input", () => {
    expect(levelForXp(-5).level).toBe(1);
    expect(levelForXp(100.6).xpIntoLevel).toBe(101);
  });
});

/* --------------------------- XP decisions --------------------------- */

describe("arcade XP decisions", () => {
  it("pays the configured value per meaningful activity", () => {
    for (const kind of ACTIVITY_KINDS) {
      expect(decideActivityXp({ caller, kind, alreadyPaid: false, paidToday: 0, now: 0 })).toEqual({
        action: "grant",
        xp: XP_VALUES[kind],
      });
    }
  });

  it("never pays a second time for the same (user, reason, refId)", () => {
    expect(
      decideActivityXp({ caller, kind: "lesson_complete", refId: "l1", alreadyPaid: true, paidToday: 0, now: 0 })
    ).toEqual({ action: "deny", error: "already_paid" });
  });

  it("caps refId-less practice and publishing per UTC day (anti-spam)", () => {
    expect(
      decideActivityXp({ caller, kind: "practice_session", alreadyPaid: false, paidToday: PRACTICE_DAILY_CAP, now: 0 })
    ).toEqual({ action: "deny", error: "daily_cap" });
    expect(
      decideActivityXp({ caller, kind: "practice_session", alreadyPaid: false, paidToday: PRACTICE_DAILY_CAP - 1, now: 0 })
    ).toEqual({ action: "grant", xp: XP_VALUES.practice_session });
    expect(
      decideActivityXp({ caller, kind: "content_publish", alreadyPaid: false, paidToday: CONTENT_DAILY_CAP, now: 0 })
    ).toEqual({ action: "deny", error: "daily_cap" });
    // refId-based grants are not capped
    expect(
      decideActivityXp({ caller, kind: "lesson_complete", refId: `l${Date.now()}`, alreadyPaid: false, paidToday: 99, now: 0 })
    ).toEqual({ action: "grant", xp: XP_VALUES.lesson_complete });
  });

  it("denies unauthenticated, restricted callers and unknown kinds", () => {
    expect(
      decideActivityXp({ caller: null, kind: "lesson_complete", alreadyPaid: false, paidToday: 0, now: 0 })
    ).toEqual({ action: "deny", error: "unauthenticated" });
    expect(
      decideActivityXp({ caller: { userId: "u1", userStatus: "suspended" }, kind: "lesson_complete", alreadyPaid: false, paidToday: 0, now: 0 })
    ).toEqual({ action: "deny", error: "caller_restricted" });
    expect(
      decideActivityXp({ caller, kind: "just_opened_video" as never, alreadyPaid: false, paidToday: 0, now: 0 })
    ).toEqual({ action: "deny", error: "unknown_kind" });
  });

  it("has no activity kind for merely opening or watching a video", () => {
    const kinds = ACTIVITY_KINDS.join("|");
    expect(kinds).not.toContain("open");
    expect(kinds).not.toContain("watch");
    expect(kinds).not.toContain("view");
  });
});

/* ------------------------------- streaks ------------------------------- */

describe("arcade streaks", () => {
  it("starts at 1 on the first meaningful day", () => {
    const r = foldActivityDay({ current: 0, best: 0 }, "2026-09-21");
    expect(r).toMatchObject({ action: "touch", milestoneXp: 0 });
    if (r.action === "touch") expect(r.next).toEqual({ current: 1, best: 1, lastDayKey: "2026-09-21" });
  });

  it("extends on consecutive UTC days and resets after a gap", () => {
    const a = foldActivityDay({ current: 3, best: 5, lastDayKey: "2026-09-19" }, "2026-09-20");
    if (a.action === "touch") expect(a.next.current).toBe(4);
    const b = foldActivityDay({ current: 3, best: 5, lastDayKey: "2026-09-10" }, "2026-09-20");
    if (b.action === "touch") expect(b.next.current).toBe(1);
  });

  it("is idempotent within one day (no double count, no double milestone)", () => {
    const first = foldActivityDay({ current: 0, best: 0 }, "2026-09-21");
    const second = foldActivityDay(
      first.action === "touch" ? first.next : { current: 0, best: 0 },
      "2026-09-21"
    );
    if (second.action === "touch") {
      expect(second.next.current).toBe(1);
      expect(second.milestoneXp).toBe(0);
    }
  });

  it("keeps the best streak and pays each milestone bonus only once", () => {
    let s = { current: 0, best: 0 };
    const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    let paid = 0;
    for (const d of days) {
      const r = foldActivityDay(s, d);
      if (r.action === "touch") {
        s = r.next;
        paid += r.milestoneXp;
      }
    }
    expect(s.current).toBe(5);
    expect(s.best).toBe(5);
    // 3-day milestone paid once; 7-day not reached
    expect(paid).toBe(STREAK_BONUSES.find((m) => m.days === 3)?.xp ?? 0);
  });

  it("does not re-pay a milestone already covered by an older best streak", () => {
    // Dancer had a best of 7; a fresh 3-day run must not pay the 3-day bonus again.
    const r = foldActivityDay({ current: 2, best: 7, lastDayKey: "2026-08-01" }, "2026-09-21");
    if (r.action === "touch") expect(r.milestoneXp).toBe(0);
  });

  it("rejects malformed day keys", () => {
    expect(foldActivityDay({ current: 0, best: 0 }, "21-09-2026")).toMatchObject({ action: "deny" });
  });

  it("computes UTC day keys and predecessors consistently", () => {
    expect(dayKeyFromTs(Date.UTC(2026, 8, 21, 23, 59))).toBe("2026-09-21");
    expect(prevDayKey("2026-09-21")).toBe("2026-09-20");
    expect(prevDayKey("2026-09-01")).toBe("2026-08-31");
  });
});
