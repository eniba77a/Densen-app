/**
 * DENSEN — Practice wire (Day 12).
 * ================================
 * Applies the pure practice core inside Convex transactions and folds every
 * grant through the shared Day 9/10 ledger helpers, so practice completion:
 *   - writes ONE xpTransactions row (kind `practice_complete`),
 *   - pays credits for combo/choreography/class kinds via the Day 10 probe,
 *   - folds the daily streak (real practice = meaningful activity),
 *   - re-evaluates achievements from server stats (COMBO MACHINE, CREATOR…).
 *
 * Anti-farm: the completion probe (`practice_complete:<itemId>` on the
 * ledger) makes re-completion re-pay impossible; item.completedAt set in
 * the same transaction double-locks it. XP for kind is challenge-driven
 * via `practice_complete` overrides (challenge-defined XP honored).
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

import {
  DEFAULT_STEPS,
  SESSION_MAX_SECONDS,
  SESSION_MIN_SECONDS,
  isPracticeKind,
  decideComplete,
  progressOf,
  sanitizeRef,
  sortForDisplay,
  stepsFromPlan,
  summarize,
  toggleStep,
  type PracticeItemView,
  type PracticeKind,
  type StepState,
} from "./practice";
import { findPaidRef, foldStreakForActivity, grantActivityXp } from "./arcadeInternals";
import { callerFromToken } from "./content";
import { evaluateAchievements, statsFor } from "./achievementsInternals";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------ helpers ------------------------------ */

interface CallerView {
  userId: string;
  userStatus: string;
}

/** Resolve the caller from a session token (null when invalid/unknown). */
async function requireCaller(db: any, sessionToken: string): Promise<CallerView | null> {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const user = (await db.get(caller.userId)) as any;
  if (!user) return null;
  return { userId: String(caller.userId), userStatus: String(user.status ?? "active") };
}

/** XP/credit kind for a practice completion, by content kind. */
function xpKindFor(kind: PracticeKind): "lesson_complete" | "combo_complete" | "choreography_complete" {
  return kind === "combo"
    ? "combo_complete"
    : kind === "choreography"
      ? "choreography_complete"
      : "lesson_complete";
}

/** Projection used by every query. */
async function projectItem(row: any): Promise<PracticeItemView> {
  const steps = (row.steps ?? []) as StepState[];
  const progress = progressOf(steps);
  return {
    id: String(row._id),
    kind: row.kind as PracticeKind,
    title: row.title as string,
    subtitle: row.subtitle as string | undefined,
    style: row.style as string | undefined,
    difficulty: row.difficulty as string | undefined,
    contentRef: row.contentRef as string,
    href: row.href as string | undefined,
    steps,
    progress,
    completedAt: row.completedAt as number | undefined,
    sessionCount: (row.sessionCount ?? 0) as number,
    lastPracticedAt: row.lastPracticedAt as number | undefined,
    totalSeconds: (row.totalSeconds ?? 0) as number,
    bestAttemptRef: row.bestAttemptRef as string | undefined,
    createdAt: row.createdAt as number,
  };
}

/** Denormalized aggregate refresh (session rows are the source of truth). */
async function refreshAggregates(db: any, itemId: string, now: number): Promise<void> {
  const sessions = (await db
    .query("practiceSessionsLog")
    .withIndex("by_item", (q: any) => q.eq("itemId", itemId))
    .collect()) as any[];
  const totalSeconds = sessions.reduce((s, r) => s + ((r.seconds as number) || 0), 0);
  const last = sessions.reduce((m, r) => Math.max(m, (r.createdAt as number) || 0), 0);
  await db.patch(itemId as never, {
    sessionCount: sessions.length,
    totalSeconds,
    lastPracticedAt: last > 0 ? last : now,
  } as never);
}

/* ------------------------------ mutations ------------------------------ */

/**
 * SAVE to MY PRACTICE. Idempotent per (user, kind, contentRef): saving the
 * same content twice returns the existing item instead of duplicating.
 */
export const saveItem = mutationGeneric({
  args: {
    sessionToken: v.string(),
    kind: v.string(),
    title: v.string(),
    subtitle: v.optional(v.string()),
    style: v.optional(v.string()),
    difficulty: v.optional(v.string()),
    contentRef: v.string(),
    href: v.optional(v.string()),
    steps: v.optional(v.array(v.string())),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    if (!isPracticeKind(args.kind)) return { ok: false as const, error: "bad_kind" as const };
    const title = String(args.title ?? "").trim().slice(0, 120);
    if (title.length === 0) return { ok: false as const, error: "bad_title" as const };
    if (typeof args.contentRef !== "string" || args.contentRef.length === 0 || args.contentRef.length > 256) {
      return { ok: false as const, error: "bad_content_ref" as const };
    }

    // Idempotent save: one practice item per (user, kind, contentRef).
    const existing = (await ctx.db
      .query("practiceItems")
      .withIndex("by_user", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const dup = existing.find((r) => r.kind === args.kind && r.contentRef === args.contentRef);
    if (dup) return { ok: true as const, itemId: String(dup._id), alreadySaved: true as const };

    const labels = args.steps && args.steps.length > 0 ? args.steps.map((s: any) => String(s).trim().slice(0, 120)).filter(Boolean) : DEFAULT_STEPS[args.kind as PracticeKind];
    await ctx.db.insert("practiceItems", {
      userId: c.userId as never,
      kind: args.kind,
      title,
      subtitle: args.subtitle ? String(args.subtitle).slice(0, 200) : undefined,
      style: args.style ? String(args.style).slice(0, 40) : undefined,
      difficulty: args.difficulty ? String(args.difficulty).slice(0, 30) : undefined,
      contentRef: args.contentRef,
      href: args.href ? String(args.href).slice(0, 200) : undefined,
      steps: stepsFromPlan(labels),
      createdAt: now,
    } as never);
    return { ok: true as const, alreadySaved: false as const };
  },
});

/** Toggle one step of one practice item (progress source of truth). */
export const toggleItemStep = mutationGeneric({
  args: { sessionToken: v.string(), itemId: v.string(), index: v.number() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const row = (await ctx.db.get(args.itemId as never)) as any;
    if (!row) return { ok: false as const, error: "not_found" as const };
    if (String(row.userId) !== String(c.userId)) return { ok: false as const, error: "not_own" as const };

    const steps = toggleStep((row.steps ?? []) as StepState[], args.index);
    const patch: Record<string, unknown> = { steps };
    // Auto-complete bookkeeping happens in completeItem (rewards go through
    // the ledger there); the checkbox itself never pays anything.
    if (row.completedAt && progressOf(steps).pct < 100) {
      // completed items keep completedAt (progress may not regress rewards)
      patch.steps = steps;
    }
    await ctx.db.patch(row._id as never, patch as never);
    return { ok: true as const, steps, progress: progressOf(steps) };
  },
});

/**
 * RECORD MY ATTEMPT — one meaningful practice session on an item. Sessions
 * below SESSION_MIN_SECONDS are rejected (no practice theater). Optional
 * attempt video ref + teacher video ref (side-by-side compare pair) — refs
 * from the media module only, sanitized here.
 */
export const recordSession = mutationGeneric({
  args: {
    sessionToken: v.string(),
    itemId: v.string(),
    seconds: v.number(),
    attemptVideoRef: v.optional(v.string()),
    teacherVideoRef: v.optional(v.string()),
  },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const row = (await ctx.db.get(args.itemId as never)) as any;
    if (!row) return { ok: false as const, error: "not_found" as const };
    if (String(row.userId) !== String(c.userId)) return { ok: false as const, error: "not_own" as const };

    if (!Number.isFinite(args.seconds) || args.seconds < SESSION_MIN_SECONDS) {
      return { ok: false as const, error: "too_short" as const };
    }
    if (args.seconds > SESSION_MAX_SECONDS) return { ok: false as const, error: "too_long" as const };

    const attemptRef = sanitizeRef(args.attemptVideoRef);
    const teacherRef = sanitizeRef(args.teacherVideoRef);

    await ctx.db.insert("practiceSessionsLog", {
      userId: c.userId as never,
      itemId: row._id,
      seconds: Math.round(args.seconds),
      attemptVideoRef: attemptRef,
      teacherVideoRef: teacherRef,
      createdAt: now,
    } as never);

    // XP — refId-less practice_session grant (daily-capped, Day 9 rules).
    const pay = await grantActivityXp(ctx.db, c.userId, c.userStatus, "practice_session", undefined, now);
    const milestoneXp = await foldStreakForActivity(ctx.db, c.userId, now);
    await refreshAggregates(ctx.db, row._id, now);

    return {
      ok: true as const,
      xpGranted: pay.granted,
      xpError: pay.error,
      streakMilestoneXp: milestoneXp,
    };
  },
});

/**
 * COMPLETE a practice item: every applicable step done → one XP grant of the
 * kind-appropriate size + credits for combo/choreography/class + streak fold
 * + achievement re-evaluation. One completion ever per (user, item).
 */
export const completeItem = mutationGeneric({
  args: { sessionToken: v.string(), itemId: v.string() },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const row = (await ctx.db.get(args.itemId as never)) as any;
    if (!row) return { ok: false as const, error: "not_found" as const };
    if (String(row.userId) !== String(c.userId)) return { ok: false as const, error: "not_own" as const };
    const kind = row.kind as PracticeKind;
    if (!isPracticeKind(kind)) return { ok: false as const, error: "bad_kind" as const };
    const xpKind = xpKindFor(kind);

    const alreadyPaid = Boolean(
      await findPaidRef(ctx.db, c.userId, xpKind, `practice:${args.itemId}`)
    );
    const decision = decideComplete({
      signedIn: true,
      item: { userId: String(row.userId), completedAt: row.completedAt as number | undefined },
      callerUserId: c.userId,
      alreadyPaid,
      steps: (row.steps ?? []) as StepState[],
      kind,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error as never };

    // Auto-check any remaining steps so the item's visible state matches the
    // paid completion (defense against stale UI state).
    const steps = ((row.steps ?? []) as StepState[]).map((s) =>
      s.done === false ? { label: s.label, done: true as const } : s
    );

    // Rewards — through the shared ledger helpers (Day 9/10 rules apply:
    // idempotency probe by (user, kind, refId) makes re-pay impossible).
    const pay = await grantActivityXp(ctx.db, c.userId, c.userStatus, xpKind, `practice:${args.itemId}`, now);
    if (pay.error === "already_paid") {
      // Ledger already paid this item (e.g. re-try after a partial write):
      // not an error — just don't double-patch completedAt.
    }
    await ctx.db.patch(row._id as never, {
      steps,
      completedAt: row.completedAt ?? now,
    } as never);
    const milestoneXp = await foldStreakForActivity(ctx.db, c.userId, now);
    const stats = await statsFor(ctx.db, c.userId);
    const newAchievements = await evaluateAchievements(ctx.db, c.userId, c.userStatus, stats, now);

    return {
      ok: true as const,
      completed: true as const,
      xpGranted: pay.granted,
      xpError: pay.error,
      creditsGranted: pay.creditsGranted ?? 0,
      streakMilestoneXp: milestoneXp,
      newAchievements,
    };
  },
});

/* ------------------------------ queries ------------------------------ */

/** MY PRACTICE — the user's items, sorted for display, with aggregates. */
export const getMyPractice = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const rows = (await ctx.db
      .query("practiceItems")
      .withIndex("by_user", (q: any) => q.eq("userId", c.userId))
      .collect()) as any[];
    const items = sortForDisplay(await Promise.all(rows.map((r) => projectItem(r))));
    return { ok: true as const, items, summary: summarize(items) };
  },
});

/** One item + its session history (for the detail/compare view). */
export const getPracticeItem = queryGeneric({
  args: { sessionToken: v.string(), itemId: v.string() },
  handler: async (ctx: any, args: any) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };
    const row = (await ctx.db.get(args.itemId as never)) as any;
    if (!row) return { ok: false as const, error: "not_found" as const };
    if (String(row.userId) !== String(c.userId)) return { ok: false as const, error: "not_own" as const };
    const sessions = (
      (await ctx.db
        .query("practiceSessionsLog")
        .withIndex("by_item", (q: any) => q.eq("itemId", row._id))
        .collect()) as any[]
    )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        id: String(s._id),
        seconds: s.seconds as number,
        attemptVideoRef: s.attemptVideoRef as string | undefined,
        teacherVideoRef: s.teacherVideoRef as string | undefined,
        createdAt: s.createdAt as number,
      }));
    return { ok: true as const, item: await projectItem(row), sessions };
  },
});
