/**
 * DENSEN — Day 15 moderation core tests.
 * ======================================
 * Pins the moderation rules: the 11 closed categories, child-safety priority
 * escalation, the report state machine, intake guards (duplicates, rate
 * limits, self-reports), the staff-action vocabulary and its target-type
 * rules, the appeal gates (decisions only, affected user only, one open per
 * report), and block/mute invariants.
 */
import { describe, expect, it } from "vitest";
import {
  REPORT_CATEGORIES,
  canTransitionReport,
  contentActionApplies,
  decideAppealReview,
  decideAppealSubmission,
  decideBlock,
  decideMute,
  decideReportIntake,
  decideStaffAction,
  decideUnblock,
  isDecisionStatus,
  isReportCategory,
  priorityFor,
  queueFor,
} from "../../convex/moderation";

const CALLER = { userId: "u_me", userStatus: "active" };

/* ---------------- categories ---------------- */
describe("moderation: report categories", () => {
  it("ships exactly the 11 Day-15 categories", () => {
    expect(REPORT_CATEGORIES).toEqual([
      "child_safety",
      "harassment",
      "bullying",
      "hate",
      "sexual_content",
      "copyright",
      "dangerous_behavior",
      "spam",
      "scam",
      "impersonation",
      "other",
    ]);
  });

  it("rejects unknown categories (closed vocabulary)", () => {
    expect(isReportCategory("made_up")).toBe(false);
    expect(isReportCategory("child_safety")).toBe(true);
  });
});

/* ---------------- priority + queue ---------------- */
describe("moderation: priority and queueing", () => {
  it("child safety is ALWAYS critical", () => {
    expect(priorityFor("child_safety", false)).toBe("critical");
    expect(priorityFor("child_safety", true)).toBe("critical");
  });

  it("reports involving a minor escalate to critical regardless of category", () => {
    expect(priorityFor("spam", true)).toBe("critical");
    expect(priorityFor("other", true)).toBe("critical");
  });

  it("harassment-family categories are high; spam stays normal", () => {
    expect(priorityFor("harassment", false)).toBe("high");
    expect(priorityFor("hate", false)).toBe("high");
    expect(priorityFor("scam", false)).toBe("high");
    expect(priorityFor("spam", false)).toBe("normal");
    expect(priorityFor("copyright", false)).toBe("normal");
  });

  it("child-safety and critical reports route to the specialist queue", () => {
    expect(queueFor("child_safety", "critical")).toBe("child_safety");
    expect(queueFor("spam", "critical")).toBe("child_safety"); // minor target
    expect(queueFor("harassment", "high")).toBe("standard");
    expect(queueFor("spam", "normal")).toBe("standard");
  });
});

/* ---------------- report state machine ---------------- */
describe("moderation: report state machine", () => {
  it("follows pending → under_review → action_taken", () => {
    expect(canTransitionReport("pending", "under_review")).toEqual({ ok: true, next: "under_review" });
    expect(canTransitionReport("under_review", "action_taken")).toEqual({ ok: true, next: "action_taken" });
  });

  it("decisions (action_taken/dismissed) can be appealed, then resolved", () => {
    expect(canTransitionReport("action_taken", "appealed").ok).toBe(true);
    expect(canTransitionReport("dismissed", "appealed").ok).toBe(true);
    expect(canTransitionReport("appealed", "resolved")).toEqual({ ok: true, next: "resolved" });
  });

  it("blocks illegal transitions — resolved is terminal, dismissed is not actionable", () => {
    expect(canTransitionReport("resolved", "pending").ok).toBe(false);
    expect(canTransitionReport("dismissed", "action_taken").ok).toBe(false);
    expect(canTransitionReport("pending", "resolved").ok).toBe(false);
  });

  it("only decisions may be contested", () => {
    expect(isDecisionStatus("action_taken")).toBe(true);
    expect(isDecisionStatus("dismissed")).toBe(true);
    expect(isDecisionStatus("pending")).toBe(false);
    expect(isDecisionStatus("under_review")).toBe(false);
  });
});

/* ---------------- intake ---------------- */
describe("moderation: report intake", () => {
  const base = {
    caller: CALLER,
    targetType: "post",
    targetId: "p1",
    targetOwnerId: "u_sara",
    targetOwnerIsMinor: false,
    category: "harassment",
    details: "hostile comments",
    openReportsOnTarget: [] as unknown[],
    recentReportTimestamps: [] as number[],
    now: 1_000_000,
  };

  it("creates a report with server-resolved priority + queue", () => {
    const d = decideReportIntake(base);
    expect(d).toEqual({ action: "create", priority: "high", queue: "standard" });
  });

  it("child-safety intake lands in the specialist queue", () => {
    const d = decideReportIntake({ ...base, category: "child_safety" });
    expect(d).toEqual({ action: "create", priority: "critical", queue: "child_safety" });
  });

  it("denies guests, suspended callers, unknown categories and invalid targets", () => {
    expect(decideReportIntake({ ...base, caller: null }).action).toBe("deny");
    expect(decideReportIntake({ ...base, caller: { userId: "u", userStatus: "suspended" } }).action).toBe("deny");
    const d2 = decideReportIntake({ ...base, category: "not-a-thing" });
    expect(d2).toEqual({ action: "deny", error: "unknown_category" });
    expect(decideReportIntake({ ...base, targetType: "song" })).toEqual({ action: "deny", error: "invalid_target" });
    expect(decideReportIntake({ ...base, targetId: "" })).toEqual({ action: "deny", error: "invalid_target" });
  });

  it("blocks self-reports", () => {
    expect(decideReportIntake({ ...base, targetOwnerId: "u_me" })).toEqual({ action: "deny", error: "self_report" });
  });

  it("blocks duplicate open reports on the same target", () => {
    expect(decideReportIntake({ ...base, openReportsOnTarget: [{ status: "pending" }] })).toEqual({
      action: "deny",
      error: "duplicate_open_report",
    });
  });

  it("rate-limits beyond 10 reports/hour (anti-spam)", () => {
    const many = Array.from({ length: 10 }, (_, i) => base.now - i * 1000);
    expect(decideReportIntake({ ...base, recentReportTimestamps: many })).toEqual({ action: "deny", error: "rate_limited" });
    const few = many.slice(0, 9);
    expect(decideReportIntake({ ...base, recentReportTimestamps: few }).action).toBe("create");
  });

  it("old reports outside the window never count", () => {
    const old = Array.from({ length: 12 }, (_, i) => base.now - 3 * 60 * 60 * 1000 - i * 1000);
    expect(decideReportIntake({ ...base, recentReportTimestamps: old }).action).toBe("create");
  });
});

/* ---------------- staff actions ---------------- */
describe("moderation: staff actions", () => {
  const STAFF = { userId: "s1", role: "moderator" };

  it("fails closed without staff", () => {
    expect(decideStaffAction({ staff: null, action: "hide", targetType: "post" })).toEqual({
      action: "deny",
      error: "forbidden",
    });
    expect(decideStaffAction({ staff: { userId: "s", role: "user" }, action: "hide", targetType: "post" }).action).toBe("deny");
  });

  it("rejects unknown actions", () => {
    expect(decideStaffAction({ staff: STAFF, action: "delete_everything", targetType: "post" })).toEqual({
      action: "deny",
      error: "invalid_action",
    });
  });

  it("content actions apply only to content targets; account actions only to users", () => {
    expect(decideStaffAction({ staff: STAFF, action: "hide", targetType: "post" })).toEqual({ action: "allow" });
    expect(decideStaffAction({ staff: STAFF, action: "remove", targetType: "comment" })).toEqual({ action: "allow" });
    expect(decideStaffAction({ staff: STAFF, action: "hide", targetType: "user" })).toEqual({
      action: "deny",
      error: "wrong_target_type",
    });
    expect(decideStaffAction({ staff: STAFF, action: "suspend_user", targetType: "user" })).toEqual({ action: "allow" });
    expect(decideStaffAction({ staff: STAFF, action: "restrict_messaging", targetType: "user" })).toEqual({ action: "allow" });
    expect(decideStaffAction({ staff: STAFF, action: "suspend_user", targetType: "post" })).toEqual({
      action: "deny",
      error: "wrong_target_type",
    });
  });

  it("contentActionApplies matches the vocabulary", () => {
    expect(contentActionApplies("post")).toBe(true);
    expect(contentActionApplies("challenge")).toBe(true);
    expect(contentActionApplies("user")).toBe(false);
  });
});

/* ---------------- appeals ---------------- */
describe("moderation: appeals", () => {
  const decisionReport = {
    status: "action_taken",
    targetType: "post",
    targetId: "p1",
    targetOwnerId: "u_me",
  };

  it("only the affected user may appeal", () => {
    const d = decideAppealSubmission({
      caller: CALLER,
      report: decisionReport,
      statement: "this was a misunderstanding, the choreography is mine",
      existingAppeals: [],
    });
    expect(d).toEqual({ action: "create" });
    const other = decideAppealSubmission({
      caller: { userId: "u_other", userStatus: "active" },
      report: decisionReport,
      statement: "this was a misunderstanding, the choreography is mine",
      existingAppeals: [],
    });
    expect(other).toEqual({ action: "deny", error: "not_reported_or_affected" });
  });

  it("only decisions may be contested", () => {
    const d = decideAppealSubmission({
      caller: CALLER,
      report: { ...decisionReport, status: "pending" },
      statement: "this was a misunderstanding",
      existingAppeals: [],
    });
    expect(d).toEqual({ action: "deny", error: "not_a_decision" });
  });

  it("one open appeal at a time", () => {
    const d = decideAppealSubmission({
      caller: CALLER,
      report: decisionReport,
      statement: "this was a misunderstanding",
      existingAppeals: [{ status: "under_review" }],
    });
    expect(d).toEqual({ action: "deny", error: "appeal_exists" });
    const ok = decideAppealSubmission({
      caller: CALLER,
      report: decisionReport,
      statement: "this was a misunderstanding",
      existingAppeals: [{ status: "upheld" }], // closed — a new appeal may start
    });
    expect(ok.action).toBe("create");
  });

  it("statements must be meaningful (>= 10 chars)", () => {
    expect(
      decideAppealSubmission({ caller: CALLER, report: decisionReport, statement: "no", existingAppeals: [] })
    ).toEqual({ action: "deny", error: "invalid_statement" });
  });

  it("guests cannot appeal", () => {
    expect(
      decideAppealSubmission({ caller: null, report: decisionReport, statement: "this was a mistake", existingAppeals: [] })
    ).toEqual({ action: "deny", error: "unauthenticated" });
  });

  it("appeal review is staff-only and follows the state machine", () => {
    expect(decideAppealReview(null, "submitted", "under_review").action).toBe("deny");
    expect(decideAppealReview({ userId: "s", role: "user" }, "submitted", "under_review").action).toBe("deny");
    expect(decideAppealReview({ userId: "s", role: "moderator" }, "submitted", "under_review")).toEqual({
      action: "apply",
      next: "under_review",
    });
    expect(decideAppealReview({ userId: "s", role: "moderator" }, "submitted", "overturned")).toEqual({
      action: "apply",
      next: "overturned",
    });
    expect(decideAppealReview({ userId: "s", role: "moderator" }, "resolved", "overturned").action).toBe("deny");
    expect(decideAppealReview({ userId: "s", role: "moderator" }, "nowhere", "upheld").action).toBe("deny");
  });
});

/* ---------------- block / mute ---------------- */
describe("moderation: block and mute", () => {
  it("block: no self-block, no duplicates, unblock requires an existing row", () => {
    expect(decideBlock({ caller: CALLER, targetUserId: "u_sara", existing: false })).toEqual({ action: "insert" });
    expect(decideBlock({ caller: CALLER, targetUserId: "u_me", existing: false })).toEqual({ action: "deny", error: "self_block" });
    expect(decideBlock({ caller: CALLER, targetUserId: "u_sara", existing: true })).toEqual({ action: "deny", error: "already_blocked" });
    expect(decideUnblock({ caller: CALLER, existing: false })).toEqual({ action: "deny", error: "not_blocked" });
    expect(decideUnblock({ caller: CALLER, existing: true })).toEqual({ action: "delete" });
  });

  it("mute: same invariants, quieter semantics", () => {
    expect(decideMute({ caller: CALLER, targetUserId: "u_sara", existing: false })).toEqual({ action: "insert" });
    expect(decideMute({ caller: CALLER, targetUserId: "u_me", existing: false })).toEqual({ action: "deny", error: "self_mute" });
    expect(decideMute({ caller: CALLER, targetUserId: "u_sara", existing: true })).toEqual({ action: "deny", error: "already_muted" });
  });

  it("guests can never block or mute", () => {
    expect(decideBlock({ caller: null, targetUserId: "u_sara", existing: false }).action).toBe("deny");
    expect(decideMute({ caller: null, targetUserId: "u_sara", existing: false }).action).toBe("deny");
  });
});
