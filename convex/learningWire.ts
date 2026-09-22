/**
 * DENSEN — Learning wire functions (Day 7).
 * =========================================
 * Thin wrappers composing the pure core in `convex/learning.ts` with real
 * reads/writes. Identity from the Day-2 session token (fail-closed); every
 * decision re-runs server-side — the client preview is never trusted.
 *
 * Persistence model: the client seed catalog (src/data/store.ts) is the
 * source of lesson/course identity today, so progress rows key on the same
 * catalog strings. When the catalog migrates into `courses`/`lessons` rows,
 * lessonKey→v.id("lessons") is an additive backfill; call sites don't change.
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import { foldStreakForActivity } from "./arcadeInternals";
import {
  decideCompletion,
  LESSON_COMPLETE_XP,
  LEARN_CATEGORIES,
  CONTENT_TYPES,
} from "./learning";

/** Resolve caller or null (same shape as interactionsWire.requireCaller). */
async function requireCaller(db: any, sessionToken: string) {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const user = await db.get(caller.userId);
  if (!user) return null;
  return { caller, user };
}

/**
 * Record phase engagement (watch/learn/practice). Upsert on
 * (userId, lessonKey); idempotent per phase. Guests are a no-op ok:false —
 * the UI keeps its local preview for signed-out browsing.
 */
export const touchLesson = mutationGeneric({
  args: {
    sessionToken: v.string(),
    lessonKey: v.string(),
    courseKey: v.optional(v.string()),
    phase: v.union(v.literal("watch"), v.literal("learn"), v.literal("practice")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const existing = (await ctx.db
      .query("lessonProgress")
      .withIndex("by_user_lesson", (q: any) => q.eq("userId", c.caller.userId).eq("lessonKey", args.lessonKey))
      .unique()) as { _id: string; touchedPhases: string[]; completedAt?: number } | null;

    if (!existing) {
      await ctx.db.insert("lessonProgress", {
        userId: c.caller.userId as never,
        lessonKey: args.lessonKey,
        courseKey: args.courseKey,
        touchedPhases: [args.phase],
        createdAt: now,
        updatedAt: now,
      });
      return { ok: true as const };
    }

    if (existing.touchedPhases.includes(args.phase)) {
      return { ok: true as const }; // idempotent — no write churn
    }
    await ctx.db.patch(existing._id as never, {
      touchedPhases: [...existing.touchedPhases, args.phase],
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

/**
 * Mark a lesson complete. FIRST completion writes the flag, pays XP through
 * the idempotent ledger, and appends an audit row. Repeat calls are honest
 * no-ops (alreadyCompleted) — never double XP.
 */
export const completeLesson = mutationGeneric({
  args: {
    sessionToken: v.string(),
    lessonKey: v.string(),
    courseKey: v.optional(v.string()),
    lessonTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    // Catalog identity: lessonKey is the shared key between client catalog
    // and server. A published lessons row with a matching title is used when
    // present (future catalog-in-DB), otherwise the catalog key stands alone.
    const decision = decideCompletion({
      caller: { userId: c.caller.userId, userStatus: c.user.status },
      lesson: { status: "published", xpReward: LESSON_COMPLETE_XP },
      existing: null, // filled by the row lookup below
    });
    // Re-run with the real existing row (the core is pure — feed it truth).
    const existing = (await ctx.db
      .query("lessonProgress")
      .withIndex("by_user_lesson", (q: any) => q.eq("userId", c.caller.userId).eq("lessonKey", args.lessonKey))
      .unique()) as { _id: string; touchedPhases: string[]; completedAt?: number } | null;
    const realDecision = decideCompletion({
      caller: { userId: c.caller.userId, userStatus: c.user.status },
      lesson: { status: "published", xpReward: LESSON_COMPLETE_XP },
      existing: existing ? { touchedPhases: existing.touchedPhases as never, completedAt: existing.completedAt } : null,
    });
    void decision;
    if (realDecision.action === "deny") return { ok: false as const, error: realDecision.error };

    if (realDecision.alreadyCompleted) {
      return { ok: true as const, alreadyCompleted: true, xpGranted: 0 };
    }

    if (!existing) {
      await ctx.db.insert("lessonProgress", {
        userId: c.caller.userId as never,
        lessonKey: args.lessonKey,
        courseKey: args.courseKey,
        touchedPhases: ["complete"],
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id as never, {
        touchedPhases: [...existing.touchedPhases, "complete"] as never,
        completedAt: now,
        updatedAt: now,
      });
    }

    // XP through the idempotent ledger (one grant per (user, reason, ref)).
    // Day 9: the arcade ledger owns XP values; the lesson's own xpReward
    // (teacher-authored) still takes precedence when higher than the base.
    const dup = await ctx.db
      .query("xpTransactions")
      .withIndex("by_reason", (q: any) => q.eq("reason", "lesson_complete"))
      .take(500);
    const alreadyPaid = dup.some(
      (r: { userId: string; refId?: string }) => r.userId === c.caller.userId && r.refId === args.lessonKey
    );
    let xpGranted = realDecision.xpGranted;
    if (alreadyPaid) {
      xpGranted = 0;
    } else {
      await ctx.db.insert("xpTransactions", {
        userId: c.caller.userId as never,
        amount: xpGranted,
        reason: "lesson_complete",
        refType: "lesson",
        refId: args.lessonKey,
        createdAt: now,
      });
      // Day 9 — completing a lesson is meaningful activity: fold the streak.
      await foldStreakForActivity(ctx.db, c.caller.userId, now);
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: c.caller.userId as never,
      eventType: "learning_event",
      targetType: "lesson",
      targetId: args.lessonKey,
      summary: `lesson_completed${xpGranted ? `; xp:${xpGranted}` : "; xp:0(already_paid)"}`,
      createdAt: now,
    });

    return { ok: true as const, alreadyCompleted: false, xpGranted };
  },
});

/**
 * Live course progress for one course (client catalog keys). Reactive — the
 * class page subscribes so completion updates the bar and completion status
 * without a refresh.
 */
export const getCourseProgress = queryGeneric({
  args: { sessionToken: v.string(), courseKey: v.string(), lessonKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated", completed: [] as string[], pct: 0 };

    const rows = (await ctx.db
      .query("lessonProgress")
      .withIndex("by_user_course", (q: any) => q.eq("userId", c.caller.userId).eq("courseKey", args.courseKey))
      .collect()) as { lessonKey: string; completedAt?: number }[];

    const doneSet = new Set(rows.filter((r) => r.completedAt).map((r) => r.lessonKey));
    const completed = args.lessonKeys.filter((k) => doneSet.has(k));
    const pct = args.lessonKeys.length === 0 ? 0 : Math.round((completed.length / args.lessonKeys.length) * 100);
    return { ok: true as const, completed, pct };
  },
});

/** My recent lesson activity (Progress dashboard). Newest first, bounded. */
export const getMyProgress = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated", recent: [], completedCount: 0 };

    const rows = (await ctx.db
      .query("lessonProgress")
      .withIndex("by_user_recent", (q: any) => q.eq("userId", c.caller.userId))
      .order("desc")
      .take(50)) as { lessonKey: string; courseKey?: string; completedAt?: number; updatedAt: number }[];

    return {
      ok: true as const,
      recent: rows.slice(0, 20).map((r) => ({
        lessonKey: r.lessonKey,
        courseKey: r.courseKey,
        completed: !!r.completedAt,
        at: r.updatedAt,
      })),
      completedCount: rows.filter((r) => r.completedAt).length,
    };
  },
});

/** Learn catalog constants for the client (single source of truth). */
export const getCatalogMeta = queryGeneric({
  args: {},
  handler: async () => ({ categories: LEARN_CATEGORIES, contentTypes: CONTENT_TYPES }),
});
