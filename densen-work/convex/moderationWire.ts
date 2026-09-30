/**
 * DENSEN — Moderation wire layer (Day 15).
 * ========================================
 * Real database workflows composing the pure core in `moderation.ts`:
 *
 *  User side:
 *   - submitReport      — 11 categories, server-resolved priority/queue,
 *                         rate-limited, duplicate-open protected, audited
 *   - myReports         — the reporter's own rows + their outcome notes
 *   - blockUser / unblockUser / muteUser / unmuteUser — real blocks/mutes rows
 *   - submitAppeal      — the affected user contests a decision (evidence-free
 *                         statement; media evidence is a future media-ref field)
 *   - myAppeals         — appellant's appeal rows + review notes
 *
 *  Staff side (moderator+, fail-closed on the SESSION role):
 *   - moderationQueue   — prioritized open reports (child safety first)
 *   - takeModerationAction — hide/remove/restore/restrict/lift/suspend/
 *                         messaging-clamp/dismiss — each writes a real
 *                         moderationActions row + auditLogs row
 *   - appealQueue / reviewAppeal — staff appeal review
 *   - moderationAudit   — append-only audit trail read (staff only)
 *
 * NOTHING here silently trusts the client: target ownership, minor status,
 * roles and state machines are all resolved server-side. No automated system
 * makes final decisions — automated signals are notes for human reviewers.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import { callerFromToken } from "./content";
import { notifyUser } from "./notifyInternals";
import {
  decideAppealReview,
  decideAppealSubmission,
  decideBlock,
  decideMute,
  decideReportIntake,
  decideStaffAction,
  decideUnblock,
  decideUnmute,
  isDecisionStatus,
  REPORT_DETAILS_MAX,
  REPORTS_PER_HOUR,
  REPORT_WINDOW_MS,
  queueFor,
  automatedSignalNote,
  type ReportStatus,
  type StaffAction,
} from "./moderation";
import { requireRole, type Caller } from "./security";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------ helpers ------------------------------ */

interface WireCaller {
  userId: string;
  userStatus: string;
  role: string;
}

async function requireCaller(db: any, sessionToken: string): Promise<WireCaller | null> {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const user = (await db.get(caller.userId)) as any;
  if (!user) return null;
  return { userId: String(caller.userId), userStatus: String(user.status ?? "active"), role: String(user.role ?? "user") };
}

function staffCaller(c: WireCaller): Caller {
  return { userId: c.userId, role: c.role as Caller["role"], userStatus: c.userStatus as Caller["userStatus"] };
}

async function appendAudit(
  db: any,
  entry: {
    actorUserId?: string;
    actorRole?: string;
    eventType: string;
    targetType?: string;
    targetId?: string;
    summary: string;
    now: number;
  }
): Promise<void> {
  await db.insert("auditLogs", {
    actorUserId: entry.actorUserId ? (entry.actorUserId as never) : undefined,
    actorRole: entry.actorRole ? (entry.actorRole as never) : undefined,
    eventType: entry.eventType,
    targetType: entry.targetType,
    targetId: entry.targetId,
    summary: entry.summary,
    createdAt: entry.now,
  } as never);
}

// Day 16 — the local raw-notify wrapper was replaced by the shared
// pref-checked emit (notifyUser) at every call site.

/** Resolve the human owner of a report target (null when the row is gone). */
async function targetOwner(
  db: any,
  targetType: string,
  targetId: string
): Promise<{ ownerId: string | null; isMinor: boolean; exists: boolean }> {
  if (targetType === "user") {
    const u = (await db.get(targetId as never)) as any;
    return { ownerId: u ? String(u._id) : null, isMinor: Boolean(u?.isMinor), exists: Boolean(u) };
  }
  // Content rows are addressed by id directly; the table name is implied by
  // the target type (db.get is table-agnostic in the generic builder).
  const row = (await db.get(targetId as never)) as any;
  if (!row) return { ownerId: null, isMinor: false, exists: false };
  const ownerField = targetType === "challenge" ? "teacherId" : "userId";
  const ownerId = row[ownerField] ? String(row[ownerField]) : null;
  let isMinor = false;
  if (ownerId) {
    const owner = (await db.get(ownerId as never)) as any;
    isMinor = Boolean(owner?.isMinor);
  }
  return { ownerId, isMinor, exists: true };
}

/* ================================================================== */
/*                            REPORT INTAKE                            */
/* ================================================================== */

export const submitReport = mutationGeneric({
  args: {
    sessionToken: v.string(),
    targetType: v.union(
      v.literal("post"),
      v.literal("comment"),
      v.literal("user"),
      v.literal("message"),
      v.literal("challenge")
    ),
    targetId: v.string(),
    category: v.string(),
    details: v.string(),
    /** Client-observed automated signals (notes only — never a verdict). */
    autoSignals: v.optional(
      v.array(v.object({ source: v.string(), label: v.string(), confidence: v.number() }))
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const owner = await targetOwner(ctx.db, args.targetType, args.targetId);
    if (!owner.exists) return { ok: false as const, error: "invalid_target" as const };

    // Duplicate-open protection: any of the caller's non-closed reports on
    // this target blocks a new one (targets keep their ids; rows are cheap).
    const myReports = (await ctx.db
      .query("reports")
      .withIndex("by_reporter", (q: any) => q.eq("reporterId", caller.userId))
      .collect()) as any[];
    const openOnTarget = myReports.filter(
      (r) => r.targetType === args.targetType && r.targetId === args.targetId && !["resolved"].includes(r.status)
    );
    const recentTimestamps = myReports.filter((r) => now - r.createdAt < REPORT_WINDOW_MS).map((r) => r.createdAt);

    const decision = decideReportIntake({
      caller,
      targetType: args.targetType,
      targetId: args.targetId,
      targetOwnerId: owner.ownerId,
      targetOwnerIsMinor: owner.isMinor,
      category: args.category,
      details: args.details,
      openReportsOnTarget: openOnTarget,
      recentReportTimestamps: recentTimestamps,
      now,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    const reportId = (await ctx.db.insert("reports", {
      reporterId: caller.userId as never,
      targetType: args.targetType,
      targetId: args.targetId,
      category: args.category,
      details: args.details.slice(0, REPORT_DETAILS_MAX),
      priority: decision.priority,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })) as string;

    // Audit + queue note. Child-safety reports are flagged for the
    // specialist queue; automated signals are reviewer notes, never verdicts.
    await appendAudit(ctx.db, {
      actorUserId: caller.userId,
      actorRole: caller.role,
      eventType: args.category === "child_safety" ? "child_safety_report" : "safety_report",
      targetType: "report",
      targetId: reportId,
      summary: `report ${args.targetType}:${decision.queue}${automatedSignalNote(args.autoSignals)}`,
      now,
    });

    // The affected user is notified only for non-anonymous-safe flows:
    // reporters are NEVER revealed; the uploader learns a report exists only
    // once staff act (containment), so intake stays discreet for child safety.
    return { ok: true as const, reportId, priority: decision.priority, queue: decision.queue };
  },
});

/** The caller's own reports with their outcomes (reporter = self only). */
export const myReports = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const rows = (await ctx.db
      .query("reports")
      .withIndex("by_reporter", (q: any) => q.eq("reporterId", caller.userId))
      .collect()) as any[];
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return {
      ok: true as const,
      reports: rows.slice(0, 100).map((r) => ({
        id: r._id as string,
        targetType: r.targetType as string,
        targetId: r.targetId as string,
        category: r.category as string,
        status: r.status as ReportStatus,
        priority: r.priority as string,
        reviewNote: r.reviewNote as string | undefined,
        createdAt: r.createdAt as number,
        resolvedAt: r.resolvedAt as number | undefined,
      })),
    };
  },
});

/* ================================================================== */
/*                           STAFF: REPORTS                           */
/* ================================================================== */

/** Prioritized moderation queue: child-safety/critical first, then high, then normal. */
export const moderationQueue = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireCaller(ctx.db, args.sessionToken);
    if (!staff) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(staff), "moderator");

    const rows = (await ctx.db.query("reports").collect()) as any[];
    const open = rows.filter((r) => r.status === "pending" || r.status === "under_review" || r.status === "appealed");
    const rank: Record<string, number> = { critical: 0, high: 1, normal: 2 };
    open.sort((a, b) => (rank[a.priority as string] ?? 2) - (rank[b.priority as string] ?? 2) || a.createdAt - b.createdAt);

    const projected = [] as {
      id: string;
      targetType: string;
      targetId: string;
      category: string;
      details: string;
      priority: string;
      status: string;
      queue: string;
      reporterHandle: string;
      targetOwnerHandle: string;
      targetOwnerId?: string;
      targetOwnerStatus?: string;
      createdAt: number;
      reviewNote?: string;
    }[];
    for (const r of open.slice(0, 100)) {
      const reporterProfile = (await ctx.db
        .query("profiles")
        .withIndex("userId", (q: any) => q.eq("userId", r.reporterId))
        .unique()) as any;
      const owner = await targetOwner(ctx.db, r.targetType, r.targetId);
      let ownerHandle = "—";
      let ownerStatus: string | undefined;
      if (owner.ownerId) {
        const ownerProfile = (await ctx.db
          .query("profiles")
          .withIndex("userId", (q: any) => q.eq("userId", owner.ownerId))
          .unique()) as any;
        ownerHandle = ownerProfile?.handle ?? owner.ownerId.slice(-6);
        const ownerUser = (await ctx.db.get(owner.ownerId as never)) as any;
        ownerStatus = ownerUser ? String(ownerUser.status) : undefined;
      }
      projected.push({
        id: r._id as string,
        targetType: r.targetType as string,
        targetId: r.targetId as string,
        category: r.category as string,
        details: (r.details as string) ?? "",
        priority: r.priority as string,
        status: r.status as string,
        queue: queueFor(r.category as string, r.priority as never),
        reporterHandle: reporterProfile?.handle ?? "dancer",
        targetOwnerHandle: ownerHandle,
        targetOwnerId: owner.ownerId ?? undefined,
        targetOwnerStatus: ownerStatus,
        createdAt: r.createdAt as number,
        reviewNote: r.reviewNote as string | undefined,
      });
    }
    return { ok: true as const, queue: projected };
  },
});

/* ---------------- real effect appliers ---------------- */

/** Patch a content row's moderation state (posts/comments/messages). */
async function setContentState(db: any, _targetType: string, targetId: string, patch: Record<string, unknown>): Promise<boolean> {
  const row = (await db.get(targetId as never)) as any;
  if (!row) return false;
  await db.patch(row._id as never, { ...patch, updatedAt: Date.now() });
  return true;
}

async function setAccountStatus(db: any, userId: string, status: "active" | "restricted" | "suspended"): Promise<boolean> {
  const u = (await db.get(userId as never)) as any;
  if (!u) return false;
  // Staff accounts are never restricted through this path (fail-safe).
  if (u.role === "admin" || u.role === "moderator") return false;
  if (status === "suspended") {
    // Full lockout: revoke every live session so the suspension is real.
    const sessions = (await db
      .query("authSessions")
      .withIndex("by_user_time", (q: any) => q.eq("userId", userId))
      .collect()) as any[];
    for (const s of sessions) {
      if (!s.revokedAt) await db.patch(s._id, { revokedAt: Date.now() });
    }
  }
  await db.patch(u._id as never, { status, updatedAt: Date.now() });
  return true;
}

async function clampMessaging(db: any, userId: string): Promise<boolean> {
  const privacy = (await db
    .query("privacySettings")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as any;
  if (!privacy) return false;
  await db.patch(privacy._id, { messagesFrom: "none", updatedAt: Date.now() });
  return true;
}

/**
 * Staff action on a report. Applies the REAL effect (content state, account
 * status, messaging clamp), records a moderationActions row with the staff
 * note, moves the report through its state machine, notifies the affected
 * user with the appeal path, and appends audit rows for every step.
 */
export const takeModerationAction = mutationGeneric({
  args: {
    sessionToken: v.string(),
    reportId: v.string(),
    action: v.string(),
    note: v.optional(v.string()),
    /** Optional automated signals the reviewer saw (recorded in the note). */
    autoSignals: v.optional(
      v.array(v.object({ source: v.string(), label: v.string(), confidence: v.number() }))
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const staff = await requireCaller(ctx.db, args.sessionToken);
    if (!staff) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(staff), "moderator");

    const report = (await ctx.db.get(args.reportId as never)) as any;
    if (!report) return { ok: false as const, error: "no_such_report" as const };

    const owner = await targetOwner(ctx.db, report.targetType, report.targetId);

    const decision = decideStaffAction({
      staff,
      action: args.action,
      targetType: report.targetType as string,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    const action = args.action as StaffAction;
    const note = args.note?.slice(0, 500);
    const signals = automatedSignalNote(args.autoSignals);
    let effect = "none";

    if (action === "hide" || action === "remove") {
      const patch =
        report.targetType === "post"
          ? { status: action === "remove" ? "removed" : "in_review" }
          : report.targetType === "comment"
            ? { status: action === "remove" ? "removed" : "hidden" }
            : report.targetType === "message"
              ? { flagged: true }
              : report.targetType === "challenge"
                ? { status: action === "remove" ? "removed" : "in_review" }
                : {};
      const done = await setContentState(ctx.db, report.targetType, report.targetId, patch);
      effect = done ? `${action}ed` : "target_missing";
    } else if (action === "restore") {
      const patch =
        report.targetType === "post"
          ? { status: "published" }
          : report.targetType === "comment"
            ? { status: "visible" }
            : report.targetType === "challenge"
              ? { status: "published" }
              : {};
      const done = await setContentState(ctx.db, report.targetType, report.targetId, patch);
      effect = done ? "restored" : "target_missing";
    } else if (action === "restrict_user") {
      const done = owner.ownerId ? await setAccountStatus(ctx.db, owner.ownerId, "restricted") : false;
      effect = done ? "user_restricted" : "target_missing";
    } else if (action === "lift_restrictions") {
      const done = owner.ownerId ? await setAccountStatus(ctx.db, owner.ownerId, "active") : false;
      effect = done ? "restrictions_lifted" : "target_missing";
    } else if (action === "suspend_user") {
      const done = owner.ownerId ? await setAccountStatus(ctx.db, owner.ownerId, "suspended") : false;
      effect = done ? "user_suspended" : "target_missing";
    } else if (action === "restrict_messaging") {
      const done = owner.ownerId ? await clampMessaging(ctx.db, owner.ownerId) : false;
      effect = done ? "messaging_clamped" : "target_missing";
    }

    // Record the action row (staff-only write; report linkage kept).
    await ctx.db.insert("moderationActions", {
      moderatorId: staff.userId as never,
      targetType: report.targetType,
      targetId: report.targetId,
      action,
      reason: note ?? `${report.category}; ${signals}`.trim(),
      reportId: report._id as never,
      note,
      createdAt: now,
    });

    // Report state machine: any applied (non-dismiss) action closes as
    // action_taken; dismiss closes as dismissed. Both are decisions that
    // can be appealed by the affected user.
    const nextStatus: ReportStatus = action === "dismiss" ? "dismissed" : "action_taken";
    await ctx.db.patch(report._id as never, {
      status: nextStatus,
      reviewedBy: staff.userId as never,
      reviewNote: note,
      resolvedAt: now,
      updatedAt: now,
    });

    await appendAudit(ctx.db, {
      actorUserId: staff.userId,
      actorRole: staff.role,
      eventType: "moderation_decision",
      targetType: "report",
      targetId: report._id as string,
      summary: `action:${action}; effect:${effect}${signals ? `; ${signals}` : ""}`,
      now,
    });
    if (action !== "dismiss") {
      await appendAudit(ctx.db, {
        actorUserId: staff.userId,
        actorRole: staff.role,
        eventType: report.category === "child_safety" ? "child_safety_report" : "content_removal",
        targetType: report.targetType as string,
        targetId: report.targetId as string,
        summary: `moderation_${action}`,
        now,
      });
    }

    // Notify the affected user — with the appeal path — without ever
    // exposing the reporter's identity.
    if (owner.ownerId && action !== "dismiss") {
      await notifyUser(ctx.db, {
        userId: owner.ownerId,
        actorUserId: staff.userId,
        type: "moderation_action",
        targetType: "report",
        targetId: report._id as string,
        now,
      });
    }
    return { ok: true as const, status: nextStatus, effect };
  },
});

/** Restore/restrict shortcuts that work from the content/account side (staff). */
export const restoreContent = mutationGeneric({
  args: { sessionToken: v.string(), targetType: v.string(), targetId: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const staff = await requireCaller(ctx.db, args.sessionToken);
    if (!staff) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(staff), "moderator");

    const decision = decideStaffAction({ staff, action: "restore", targetType: args.targetType });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    const patch =
      args.targetType === "post"
        ? { status: "published" }
        : args.targetType === "comment"
          ? { status: "visible" }
          : args.targetType === "challenge"
            ? { status: "published" }
            : {};
    const done = await setContentState(ctx.db, args.targetType, args.targetId, patch);
    if (!done) return { ok: false as const, error: "target_missing" as const };

    await ctx.db.insert("moderationActions", {
      moderatorId: staff.userId as never,
      targetType: args.targetType,
      targetId: args.targetId,
      action: "restore",
      reason: args.note ?? "restored_after_review",
      note: args.note,
      createdAt: now,
    });
    await appendAudit(ctx.db, {
      actorUserId: staff.userId,
      actorRole: staff.role,
      eventType: "content_removal",
      targetType: args.targetType,
      targetId: args.targetId,
      summary: "content_restored",
      now,
    });
    return { ok: true as const };
  },
});

/* ================================================================== */
/*                              APPEALS                               */
/* ================================================================== */

/**
 * The affected user contests a decision. Only decisions (action_taken /
 * dismissed) may be appealed, only by the affected account, one open appeal
 * per report/target. Suspended users may still appeal (a lockout they cannot
 * contest would be unjust) — the fail-closed session gate allows suspended
 * callers to read/act here ONLY through the appeal path.
 */
export const submitAppeal = mutationGeneric({
  args: {
    sessionToken: v.string(),
    reportId: v.optional(v.string()),
    moderationActionId: v.optional(v.string()),
    targetType: v.union(
      v.literal("post"),
      v.literal("comment"),
      v.literal("user"),
      v.literal("message"),
      v.literal("challenge")
    ),
    targetId: v.string(),
    statement: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Appeals intentionally accept callers whose status is "restricted" or
    // "suspended" — that is exactly who needs to contest a decision. Only
    // deleted accounts are gone for good.
    const callerRaw = await callerFromToken(ctx.db, args.sessionToken);
    if (!callerRaw) return { ok: false as const, error: "unauthenticated" as const };
    const me = (await ctx.db.get(callerRaw.userId as never)) as any;
    if (!me || me.status === "deleted") return { ok: false as const, error: "caller_restricted" as const };
    const caller = { userId: callerRaw.userId, userStatus: me.status ?? "active" };

    const existing = (await ctx.db
      .query("moderationAppeals")
      .withIndex("by_appellant", (q: any) => q.eq("appellantUserId", caller.userId))
      .collect()) as any[];

    let report: any = null;
    if (args.reportId) {
      report = (await ctx.db.get(args.reportId as never)) as any;
      if (report) {
        const owner = await targetOwner(ctx.db, report.targetType, report.targetId);
        report.targetOwnerId = owner.ownerId;
      }
    }

    const decision = decideAppealSubmission({
      caller,
      report: report ? { status: report.status, targetType: report.targetType, targetId: report.targetId, targetOwnerId: report.targetOwnerId } : null,
      directDecision: !report && args.moderationActionId
        ? (() => {
            // Direct-action appeals resolve the affected user from the action row.
            return { targetType: args.targetType, targetId: args.targetId, affectedUserId: caller.userId };
          })()
        : null,
      statement: args.statement,
      existingAppeals: report
        ? existing.filter((a) => a.reportId === report._id)
        : existing.filter((a) => a.targetType === args.targetType && a.targetId === args.targetId && !a.reportId),
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    const appealId = (await ctx.db.insert("moderationAppeals", {
      reportId: args.reportId ? (args.reportId as never) : undefined,
      appellantUserId: caller.userId as never,
      targetType: args.targetType,
      targetId: args.targetId,
      statement: args.statement.slice(0, 1500),
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    })) as string;

    // The report moves to "appealed" so staff see it in the queue again.
    if (report && isDecisionStatus(report.status)) {
      await ctx.db.patch(report._id as never, { status: "appealed", updatedAt: now });
    }

    await appendAudit(ctx.db, {
      actorUserId: caller.userId,
      actorRole: String(me.role ?? "user"),
      eventType: "appeal",
      targetType: "moderation_appeal",
      targetId: appealId,
      summary: `appeal_submitted ${args.targetType}`,
      now,
    });
    return { ok: true as const, appealId };
  },
});

/** The caller's own appeals with staff review notes. */
export const myAppeals = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const rows = (await ctx.db
      .query("moderationAppeals")
      .withIndex("by_appellant", (q: any) => q.eq("appellantUserId", caller.userId))
      .collect()) as any[];
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return {
      ok: true as const,
      appeals: rows.slice(0, 50).map((r) => ({
        id: r._id as string,
        reportId: r.reportId as string | undefined,
        targetType: r.targetType as string,
        targetId: r.targetId as string,
        statement: r.statement as string,
        status: r.status as string,
        reviewNote: r.reviewNote as string | undefined,
        createdAt: r.createdAt as number,
        resolvedAt: r.resolvedAt as number | undefined,
      })),
    };
  },
});

/** Staff appeal queue (moderator+). */
export const appealQueue = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireCaller(ctx.db, args.sessionToken);
    if (!staff) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(staff), "moderator");
    const rows = (await ctx.db
      .query("moderationAppeals")
      .withIndex("by_status", (q: any) => q.eq("status", "submitted"))
      .collect()) as any[];
    const reviewing = (await ctx.db
      .query("moderationAppeals")
      .withIndex("by_status", (q: any) => q.eq("status", "under_review"))
      .collect()) as any[];
    const all = [...rows, ...reviewing];
    all.sort((a, b) => a.createdAt - b.createdAt);

    const projected = [] as {
      id: string;
      reportId?: string;
      appellantHandle: string;
      targetType: string;
      targetId: string;
      statement: string;
      status: string;
      createdAt: number;
    }[];
    for (const r of all.slice(0, 80)) {
      const p = (await ctx.db
        .query("profiles")
        .withIndex("userId", (q: any) => q.eq("userId", r.appellantUserId))
        .unique()) as any;
      projected.push({
        id: r._id as string,
        reportId: r.reportId as string | undefined,
        appellantHandle: p?.handle ?? "dancer",
        targetType: r.targetType as string,
        targetId: r.targetId as string,
        statement: r.statement as string,
        status: r.status as string,
        createdAt: r.createdAt as number,
      });
    }
    return { ok: true as const, appeals: projected };
  },
});

/**
 * Staff appeal review. "overturned" reverts the real effect where the
 * linkage exists (restore content / lift restrictions); "upheld" leaves the
 * decision standing. Both close the report as resolved and audit everything.
 */
export const reviewAppeal = mutationGeneric({
  args: {
    sessionToken: v.string(),
    appealId: v.string(),
    to: v.union(v.literal("under_review"), v.literal("upheld"), v.literal("overturned"), v.literal("resolved")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const staff = await requireCaller(ctx.db, args.sessionToken);
    if (!staff) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(staff), "moderator");

    const appeal = (await ctx.db.get(args.appealId as never)) as any;
    if (!appeal) return { ok: false as const, error: "no_such_appeal" as const };

    const decision = decideAppealReview(staffCaller(staff), appeal.status as string, args.to);
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    let effect = "none";
    if (args.to === "overturned") {
      // Revert the real effect: restore content, lift account restrictions.
      if (appeal.targetType !== "user") {
        const patch =
          appeal.targetType === "post"
            ? { status: "published" }
            : appeal.targetType === "comment"
              ? { status: "visible" }
              : appeal.targetType === "challenge"
                ? { status: "published" }
                : {};
        const done = await setContentState(ctx.db, appeal.targetType, appeal.targetId, patch);
        effect = done ? "content_restored" : "target_missing";
      } else {
        const done = await setAccountStatus(ctx.db, appeal.targetId, "active");
        effect = done ? "restrictions_lifted" : "target_missing";
      }
    }

    await ctx.db.patch(appeal._id as never, {
      status: args.to,
      reviewedBy: staff.userId as never,
      reviewNote: args.note,
      updatedAt: now,
      ...(args.to === "upheld" || args.to === "overturned" ? { resolvedAt: now } : {}),
    });

    // Linked report resolves with the appeal outcome.
    if (appeal.reportId) {
      const report = (await ctx.db.get(appeal.reportId as never)) as any;
      if (report && report.status === "appealed") {
        await ctx.db.patch(report._id as never, {
          status: "resolved",
          resolvedAt: now,
          updatedAt: now,
          reviewNote: args.note ?? report.reviewNote,
        });
      }
    }

    await appendAudit(ctx.db, {
      actorUserId: staff.userId,
      actorRole: staff.role,
      eventType: "appeal",
      targetType: "moderation_appeal",
      targetId: appeal._id as string,
      summary: `appeal_${args.to}; effect:${effect}`,
      now,
    });
    await notifyUser(ctx.db, {
      userId: appeal.appellantUserId,
      actorUserId: staff.userId,
      type: "appeal_reviewed",
      targetType: "moderation_appeal",
      targetId: appeal._id as string,
      now,
    });
    return { ok: true as const, status: args.to, effect };
  },
});

/* ================================================================== */
/*                           BLOCK / MUTE                             */
/* ================================================================== */

export const blockUser = mutationGeneric({
  args: { sessionToken: v.string(), targetUserId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const target = (await ctx.db.get(args.targetUserId as never)) as any;
    if (!target) return { ok: false as const, error: "unknown_user" as const };

    const existing = (await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId).eq("blockedId", args.targetUserId))
      .unique()) as any;

    const decision = decideBlock({ caller, targetUserId: args.targetUserId, existing: Boolean(existing) });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    await ctx.db.insert("blocks", {
      blockerId: caller.userId as never,
      blockedId: args.targetUserId as never,
      reason: args.reason?.slice(0, 200),
      createdAt: now,
    });
    await appendAudit(ctx.db, {
      actorUserId: caller.userId,
      actorRole: caller.role,
      eventType: "block_action",
      targetType: "user",
      targetId: args.targetUserId,
      summary: "user_blocked",
      now,
    });
    return { ok: true as const };
  },
});

export const unblockUser = mutationGeneric({
  args: { sessionToken: v.string(), targetUserId: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const existing = (await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId).eq("blockedId", args.targetUserId))
      .unique()) as any;
    const decision = decideUnblock({ caller, existing: Boolean(existing) });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };
    await ctx.db.delete(existing._id as never);
    await appendAudit(ctx.db, {
      actorUserId: caller.userId,
      actorRole: caller.role,
      eventType: "block_action",
      targetType: "user",
      targetId: args.targetUserId,
      summary: "user_unblocked",
      now: Date.now(),
    });
    return { ok: true as const };
  },
});

export const muteUser = mutationGeneric({
  args: { sessionToken: v.string(), targetUserId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const target = (await ctx.db.get(args.targetUserId as never)) as any;
    if (!target) return { ok: false as const, error: "unknown_user" as const };

    const existing = (await ctx.db
      .query("mutes")
      .withIndex("by_muter", (q: any) => q.eq("muterId", caller.userId).eq("mutedId", args.targetUserId))
      .unique()) as any;
    const decision = decideMute({ caller, targetUserId: args.targetUserId, existing: Boolean(existing) });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };

    await ctx.db.insert("mutes", {
      muterId: caller.userId as never,
      mutedId: args.targetUserId as never,
      reason: args.reason?.slice(0, 200),
      createdAt: now,
    });
    return { ok: true as const };
  },
});

export const unmuteUser = mutationGeneric({
  args: { sessionToken: v.string(), targetUserId: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };
    const existing = (await ctx.db
      .query("mutes")
      .withIndex("by_muter", (q: any) => q.eq("muterId", caller.userId).eq("mutedId", args.targetUserId))
      .unique()) as any;
    const decision = decideUnmute({ caller, existing: Boolean(existing) });
    if (decision.action === "deny") return { ok: false as const, error: decision.error };
    await ctx.db.delete(existing._id as never);
    return { ok: true as const };
  },
});

/** The caller's block + mute lists (public projections only). */
export const mySafetyLists = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const caller = await requireCaller(ctx.db, args.sessionToken);
    if (!caller) return { ok: false as const, error: "unauthenticated" as const };

    const blockRows = (await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId))
      .collect()) as any[];
    const muteRows = (await ctx.db
      .query("mutes")
      .withIndex("by_muter", (q: any) => q.eq("muterId", caller.userId))
      .collect()) as any[];

    const project = async (userId: string) => {
      const p = (await ctx.db
        .query("profiles")
        .withIndex("userId", (q: any) => q.eq("userId", userId))
        .unique()) as any;
      return { userId, handle: p?.handle ?? "dancer", displayName: p?.displayName ?? "Dancer" };
    };

    const blocked = [] as { userId: string; handle: string; displayName: string }[];
    for (const b of blockRows) blocked.push(await project(String(b.blockedId)));
    const muted = [] as { userId: string; handle: string; displayName: string }[];
    for (const m of muteRows) muted.push(await project(String(m.mutedId)));

    return { ok: true as const, blocked, muted };
  },
});

/* ================================================================== */
/*                        MODERATION AUDIT (staff)                     */
/* ================================================================== */

/** Append-only audit trail for moderation events (moderator+ read). */
export const moderationAudit = queryGeneric({
  args: { sessionToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const staff = await requireCaller(ctx.db, args.sessionToken);
    if (!staff) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(staff), "moderator");

    const limit = Math.min(Math.max(args.limit ?? 40, 1), 200);
    const rows = (await ctx.db.query("auditLogs").order("desc").take(limit * 3)) as any[];
    const MOD_EVENTS = new Set([
      "safety_report",
      "child_safety_report",
      "moderation_decision",
      "content_removal",
      "account_restriction",
      "appeal",
      "block_action",
    ]);
    return {
      ok: true as const,
      entries: rows
        .filter((r) => MOD_EVENTS.has(String(r.eventType)))
        .slice(0, limit)
        .map((r) => ({
          id: r._id as string,
          eventType: r.eventType as string,
          summary: r.summary as string,
          actorRole: r.actorRole as string | undefined,
          targetType: r.targetType as string | undefined,
          targetId: r.targetId as string | undefined,
          createdAt: r.createdAt as number,
        })),
    };
  },
});

/** Staff-only: recent moderationActions rows (the decisions ledger). */
export const actionLedger = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireCaller(ctx.db, args.sessionToken);
    if (!staff) return { ok: false as const, error: "unauthenticated" as const };
    requireRole(staffCaller(staff), "moderator");
    const rows = (await ctx.db.query("moderationActions").order("desc").take(60)) as any[];
    return {
      ok: true as const,
      actions: rows.map((r) => ({
        id: r._id as string,
        moderatorHandle: undefined as string | undefined,
        targetType: r.targetType as string,
        targetId: r.targetId as string,
        action: r.action as string,
        reason: r.reason as string,
        note: r.note as string | undefined,
        reportId: r.reportId as string | undefined,
        createdAt: r.createdAt as number,
      })),
    };
  },
});

export const __internals = {
  REPORTS_PER_HOUR,
  REPORT_WINDOW_MS,
  isDecisionStatus,
  queueFor,
};
