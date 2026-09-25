/**
 * DENSEN — Moderation decision core (Day 15).
 * ===========================================
 * Pure, unit-testable rules for the DENSEN moderation system. Every wire
 * function in `moderationWire.ts` composes these; nothing else decides.
 *
 * Rules pinned here (mirroring the Day 15 brief):
 *  - 11 closed REPORT categories; child_safety is always CRITICAL priority
 *    and jumps the specialist queue.
 *  - Report state machine: pending → under_review → action_taken | dismissed;
 *    action_taken → appealed → resolved. No other transitions exist.
 *  - Staff actions are a closed vocabulary mapped to real, reversible effects
 *    (content hide/remove/restore, restrict/suspend/lift, messaging clamp).
 *  - Appeals never revert anything by themselves — only staff review does.
 *  - Rate limits + anti-spam: one report per (reporter, target) while an
 *    earlier one is still open; bounded reports/hour; duplicate appeals on an
 *    already-appealed report are rejected.
 *  - Admin adjustments are always logged by the wire layer (audit append).
 */

/* ------------------------------ categories ------------------------------ */

export const REPORT_CATEGORIES = [
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
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export function isReportCategory(c: string): c is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(c);
}

/** Child safety and copyright route to their specialist queues on intake. */
export const CHILD_SAFETY_CATEGORIES: ReportCategory[] = ["child_safety"];

/* ------------------------------ priorities ------------------------------ */

export type Priority = "critical" | "high" | "normal";

const HIGH_CATEGORIES: ReportCategory[] = ["harassment", "bullying", "hate", "sexual_content", "impersonation", "scam"];

/**
 * Server-side priority. child_safety is ALWAYS critical (highest priority —
 * brief requirement); minors as the target escalate any category to critical;
 * the high list escalates to high; everything else is normal.
 */
export function priorityFor(category: string, targetIsMinor: boolean): Priority {
  if (category === "child_safety") return "critical";
  if (targetIsMinor) return "critical"; // reports involving minors escalate
  if (HIGH_CATEGORIES.includes(category as ReportCategory)) return "high";
  return "normal";
}

/** Specialist queue routing: child-safety reports must reach that queue. */
export function queueFor(category: string, priority: Priority): "child_safety" | "standard" {
  if (CHILD_SAFETY_CATEGORIES.includes(category as ReportCategory) || priority === "critical") return "child_safety";
  return "standard";
}

/* ------------------------------ report state machine ------------------------------ */

export type ReportStatus = "pending" | "under_review" | "action_taken" | "dismissed" | "appealed" | "resolved";

export type ReportTransition =
  | { ok: true; next: ReportStatus }
  | { ok: false; error: "unknown_status" | "invalid_transition" | "needs_decision" };

const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  pending: ["under_review", "action_taken", "dismissed"],
  under_review: ["action_taken", "dismissed", "pending"],
  action_taken: ["appealed", "resolved"],
  dismissed: ["appealed"], // a dismissal is a decision and can be contested
  appealed: ["resolved"], // staff resolves the appeal (upheld/overturned recorded separately)
  resolved: [],
};

export function canTransitionReport(from: string, to: string): ReportTransition {
  if (!(REPORT_TRANSITIONS as Record<string, ReportStatus[]>)[from]) return { ok: false, error: "unknown_status" };
  if (!(REPORT_TRANSITIONS as Record<string, ReportStatus[]>)[to]) return { ok: false, error: "unknown_status" };
  if (!REPORT_TRANSITIONS[from as ReportStatus].includes(to as ReportStatus)) {
    return { ok: false, error: "invalid_transition" };
  }
  return { ok: true, next: to as ReportStatus };
}

/** Only a decision state (action_taken / dismissed) may be contested. */
export function isDecisionStatus(s: string): boolean {
  return s === "action_taken" || s === "dismissed";
}

/* ------------------------------ report intake ------------------------------ */

export const REPORT_DETAILS_MAX = 1200;
export const REPORTS_PER_HOUR = 10;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;

export type ReportIntakeDecision =
  | { action: "create"; priority: Priority; queue: "child_safety" | "standard" }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "caller_restricted"
        | "unknown_category"
        | "invalid_target"
        | "self_report"
        | "duplicate_open_report"
        | "rate_limited";
    };

export interface ReportIntakeInput {
  caller: { userId: string; userStatus: string } | null;
  targetType: string;
  targetId: string;
  /** The moderated user (post/comment/message author, challenge host, profile owner). */
  targetOwnerId: string | null;
  targetOwnerIsMinor: boolean;
  category: string;
  details: string;
  /** The caller's still-open reports on this same target. */
  openReportsOnTarget: unknown[];
  /** Timestamps of the caller's reports inside the rate window. */
  recentReportTimestamps: number[];
  now: number;
}

export function decideReportIntake(input: ReportIntakeInput): ReportIntakeDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.caller.userStatus === "suspended" || input.caller.userStatus === "deleted") {
    return { action: "deny", error: "caller_restricted" };
  }
  if (!isReportCategory(input.category)) return { action: "deny", error: "unknown_category" };
  const VALID_TARGETS = ["post", "comment", "user", "message", "challenge"];
  if (!VALID_TARGETS.includes(input.targetType) || input.targetId.length === 0) {
    return { action: "deny", error: "invalid_target" };
  }
  if (input.targetOwnerId && input.targetOwnerId === input.caller.userId) {
    return { action: "deny", error: "self_report" };
  }
  if (input.openReportsOnTarget.length > 0) return { action: "deny", error: "duplicate_open_report" };
  if (input.recentReportTimestamps.filter((t) => input.now - t < REPORT_WINDOW_MS).length >= REPORTS_PER_HOUR) {
    return { action: "deny", error: "rate_limited" };
  }
  const priority = priorityFor(input.category, input.targetOwnerIsMinor);
  return { action: "create", priority, queue: queueFor(input.category, priority) };
}

/* ------------------------------ staff actions ------------------------------ */

/**
 * Closed staff-action vocabulary. Each action states what the wire layer must
 * do for real — this module never executes, it only decides permission +
 * applicability. Effects land in moderationActions rows + audit logs.
 */
export type StaffAction =
  | "hide" // restrict content (post/comment stays but hidden from feeds)
  | "remove" // remove content entirely (status → removed)
  | "restore" // restore previously hidden/removed content
  | "restrict_user" // account: visibility + interaction limits (status → restricted)
  | "lift_restrictions" // account: back to active
  | "suspend_user" // account: full lockout
  | "restrict_messaging" // messaging clamp (privacySettings.messagesFrom → none)
  | "dismiss"; // no action — report closed as unfounded

export const STAFF_ACTIONS: StaffAction[] = [
  "hide",
  "remove",
  "restore",
  "restrict_user",
  "lift_restrictions",
  "suspend_user",
  "restrict_messaging",
  "dismiss",
];

export function isStaffAction(a: string): a is StaffAction {
  return (STAFF_ACTIONS as string[]).includes(a);
}

/** Whether the target type accepts a content-level action. */
export function contentActionApplies(targetType: string): boolean {
  const contentTargets = ["post", "comment", "message", "challenge"];
  return contentTargets.includes(targetType);
}

export type StaffActionDecision =
  | { action: "allow" }
  | { action: "deny"; error: "forbidden" | "invalid_action" | "wrong_target_type" };

export interface StaffActionInput {
  staff: { userId: string; role: string } | null;
  action: string;
  targetType: string;
}

/** Moderator+ may act; nothing else decides (fail closed on role). */
export function decideStaffAction(input: StaffActionInput): StaffActionDecision {
  if (!input.staff || (input.staff.role !== "moderator" && input.staff.role !== "admin")) {
    return { action: "deny", error: "forbidden" };
  }
  if (!isStaffAction(input.action)) return { action: "deny", error: "invalid_action" };
  const a = input.action as StaffAction;
  if ((a === "hide" || a === "remove" || a === "restore") && !contentActionApplies(input.targetType)) {
    return { action: "deny", error: "wrong_target_type" };
  }
  if ((a === "restrict_user" || a === "lift_restrictions" || a === "suspend_user" || a === "restrict_messaging") && input.targetType !== "user") {
    return { action: "deny", error: "wrong_target_type" };
  }
  return { action: "allow" };
}

/* ------------------------------ appeals ------------------------------ */

export type AppealStatus = "submitted" | "under_review" | "upheld" | "overturned" | "resolved";

export type AppealSubmissionDecision =
  | { action: "create" }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "caller_restricted"
        | "not_reported_or_affected"
        | "not_a_decision"
        | "appeal_exists"
        | "invalid_statement";
    };

export interface AppealSubmissionInput {
  caller: { userId: string; userStatus: string } | null;
  /** The report being contested (null = contesting a direct action with no report). */
  report: { status: string; targetType: string; targetId: string; targetOwnerId?: string } | null;
  /** The direct moderation decision being contested when no report exists. */
  directDecision?: { targetType: string; targetId: string; affectedUserId: string } | null;
  statement: string;
  /** Existing appeal rows for this report/target by this appellant. */
  existingAppeals: { status: string }[];
}

/**
 * Only the affected party (the reported/acted-upon user) may appeal, only
 * decision states may be contested, one open appeal at a time, and the
 * statement must actually say something (min 10 chars).
 */
export function decideAppealSubmission(input: AppealSubmissionInput): AppealSubmissionDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.caller.userStatus === "deleted") return { action: "deny", error: "caller_restricted" };
  if (input.statement.trim().length < 10) return { action: "deny", error: "invalid_statement" };

  if (input.report) {
    const ownerId = input.report.targetOwnerId ?? "";
    if (input.caller.userId !== ownerId) return { action: "deny", error: "not_reported_or_affected" };
    if (!isDecisionStatus(input.report.status)) return { action: "deny", error: "not_a_decision" };
  } else if (input.directDecision) {
    if (input.caller.userId !== input.directDecision.affectedUserId) {
      return { action: "deny", error: "not_reported_or_affected" };
    }
  } else {
    return { action: "deny", error: "not_reported_or_affected" };
  }

  if (input.existingAppeals.some((a) => a.status === "submitted" || a.status === "under_review")) {
    return { action: "deny", error: "appeal_exists" };
  }
  return { action: "create" };
}

const APPEAL_TRANSITIONS: Record<AppealStatus, AppealStatus[]> = {
  submitted: ["under_review", "upheld", "overturned", "resolved"],
  under_review: ["upheld", "overturned", "resolved"],
  upheld: ["resolved"],
  overturned: ["resolved"],
  resolved: [],
};

export type AppealReviewDecision =
  | { action: "apply"; next: AppealStatus }
  | { action: "deny"; error: "forbidden" | "unknown_status" | "invalid_transition" };

export function decideAppealReview(
  staff: { userId: string; role: string } | null,
  from: string,
  to: string
): AppealReviewDecision {
  if (!staff || (staff.role !== "moderator" && staff.role !== "admin")) {
    return { action: "deny", error: "forbidden" };
  }
  if (!(APPEAL_TRANSITIONS as Record<string, AppealStatus[]>)[from]) return { action: "deny", error: "unknown_status" };
  if (!(APPEAL_TRANSITIONS as Record<string, AppealStatus[]>)[to]) return { action: "deny", error: "unknown_status" };
  if (!APPEAL_TRANSITIONS[from as AppealStatus].includes(to as AppealStatus)) {
    return { action: "deny", error: "invalid_transition" };
  }
  return { action: "apply", next: to as AppealStatus };
}

/* ------------------------------ block / mute ------------------------------ */

export type BlockDecision = { action: "insert" } | { action: "deny"; error: "unauthenticated" | "self_block" | "already_blocked" };
export type UnblockDecision = { action: "delete" } | { action: "deny"; error: "unauthenticated" | "not_blocked" };

export function decideBlock(input: {
  caller: { userId: string } | null;
  targetUserId: string;
  existing: boolean;
}): BlockDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.targetUserId === input.caller.userId) return { action: "deny", error: "self_block" };
  if (input.existing) return { action: "deny", error: "already_blocked" };
  return { action: "insert" };
}

export function decideUnblock(input: {
  caller: { userId: string } | null;
  existing: boolean;
}): UnblockDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (!input.existing) return { action: "deny", error: "not_blocked" };
  return { action: "delete" };
}

export type MuteDecision = { action: "insert" } | { action: "deny"; error: "unauthenticated" | "self_mute" | "already_muted" };
export type UnmuteDecision = { action: "delete" } | { action: "deny"; error: "unauthenticated" | "not_muted" };

export function decideMute(input: {
  caller: { userId: string } | null;
  targetUserId: string;
  existing: boolean;
}): MuteDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (input.targetUserId === input.caller.userId) return { action: "deny", error: "self_mute" };
  if (input.existing) return { action: "deny", error: "already_muted" };
  return { action: "insert" };
}

export function decideUnmute(input: {
  caller: { userId: string } | null;
  existing: boolean;
}): UnmuteDecision {
  if (!input.caller) return { action: "deny", error: "unauthenticated" };
  if (!input.existing) return { action: "deny", error: "not_muted" };
  return { action: "delete" };
}

/* ------------------------------ automated-moderation hook ------------------------------ */

/**
 * Automated-moderation hook seam. The client/server scanners already gate
 * posts/comments at creation (safetyCore). This seam is where a future
 * external classifier's verdicts would attach to the report pipeline.
 * It is explicitly a RISK-REDUCTION signal, never a verdict: automated
 * detection is not perfect and nothing here treats it as one.
 */
export interface AutomatedSignal {
  source: string; // e.g. "fingerprinting" | "text_classifier"
  label: string;
  confidence: number; // 0..1
}

export function automatedSignalNote(signals: AutomatedSignal[] | undefined): string {
  if (!signals || signals.length === 0) return "";
  return `auto_signals:${signals.map((s) => `${s.source}:${s.label}:${Math.round(s.confidence * 100)}%`).join("|")}`;
}
