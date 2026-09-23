/**
 * DENSEN — Challenges wire layer (Day 11).
 * ========================================
 * Persists the challenge lifecycle decided by the pure core: list/get
 * subscriptions, the JOIN → SUBMIT → COMPLETE mutations, reward granting,
 * and the achievements queries. Submissions are moderation-screened like
 * posts (pending → cleared), safety always gates rewards, and every XP/credit
 * reward pays through the Day 9/10 ledger helpers (idempotent per user+ref).
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import { grantActivityXp } from "./arcadeInternals";
import { awardBadge, ensureAchievementsSeed, evaluateAchievements, statsFor } from "./achievementsInternals";
import { daysLeftOf, decideComplete, decideJoin, decideSubmit, phaseOf } from "./challenges";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------ helpers ------------------------------ */

async function requireCaller(db: any, sessionToken: string) {
  return await callerFromToken(db, sessionToken);
}

/** All participant rows of a challenge (server truth for counts). */
async function participantsOf(db: any, challengeId: string) {
  return (await db
    .query("challengeParticipants")
    .withIndex("by_challenge", (q: any) => q.eq("challengeId", challengeId))
    .collect()) as any[];
}

/** The caller's participant row for a challenge. */
async function myParticipation(db: any, challengeId: string, userId: string) {
  const parts = (await db
    .query("challengeParticipants")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect()) as any[];
  return parts.find((p) => p.challengeId === challengeId) ?? null;
}

/** The caller's one submission for a challenge. */
async function mySubmission(db: any, challengeId: string, userId: string) {
  const row = (await db
    .query("challengeSubmissions")
    .withIndex("by_challenge_user", (q: any) => q.eq("challengeId", challengeId).eq("userId", userId))
    .unique()) as any;
  return row ?? null;
}

/** Ledger probe: has a `challenge_complete` XP row for this ref been paid? */
async function alreadyCompletedOnLedger(db: any, userId: string, challengeId: string) {
  const rows = (await db
    .query("xpTransactions")
    .withIndex("by_reason", (q: any) => q.eq("reason", "challenge_complete"))
    .take(500)) as any[];
  return rows.some((r) => r.userId === userId && r.refId === challengeId);
}

/** Client projection of one challenge row. */
async function projectChallenge(
  db: any,
  row: any,
  viewerUserId: string | null,
  now: number
): Promise<any> {
  const phase = phaseOf(row, now);
  const participants = await participantsOf(db, String(row._id));
  const subs = (await db
    .query("challengeSubmissions")
    .withIndex("by_challenge", (q: any) => q.eq("challengeId", row._id))
    .collect()) as any[];
  const mySub = viewerUserId ? subs.find((s) => s.userId === viewerUserId) : undefined;
  const teacher = row.teacherId ? await db.get(row.teacherId) : null;
  const video = row.videoRef ? await db.get(row.videoRef as never) : null;

  // Progress = submissions / participants (server-computed, never client-fed).
  const progressPct =
    participants.length === 0 ? 0 : Math.min(100, Math.round((subs.length / participants.length) * 100));

  // Completion probe for the viewer (ledger probe for guests = false).
  const hasCompleted = viewerUserId ? await alreadyCompletedOnLedger(db, viewerUserId, String(row._id)) : false;

  return {
    id: String(row._id),
    title: row.title as string,
    description: row.description as string,
    rules: row.rules as string | undefined,
    style: row.style as string | undefined,
    difficulty: row.difficulty as string | undefined,
    coverUrl: video?.thumbnailUrl ?? video?.url ?? undefined,
    teacherName: teacher ? ((teacher as any).displayName ?? undefined) : undefined,
    startsAt: row.startsAt as number | undefined,
    deadlineAt: row.deadlineAt as number | undefined,
    phase,
    daysLeft: daysLeftOf(row.deadlineAt, now),
    participantCount: participants.length,
    submissionCount: subs.length,
    progressPct,
    hasJoined: viewerUserId ? participants.some((p) => p.userId === viewerUserId) : false,
    hasSubmitted: Boolean(mySub),
    mySubmissionStatus: mySub?.status as string | undefined,
    hasCompleted,
    reward: row.reward ?? {},
    tutorialCourseId: row.tutorialCourseId ? String(row.tutorialCourseId) : undefined,
  };
}

/* ------------------------------ queries ------------------------------ */

/**
 * Platform-seeded DENSEN challenges (the brief's examples). Seeded ONCE by
 * `bootstrapPlatform` below — after that they are ordinary rows the whole
 * lifecycle (join/submit/complete) runs against. ONE MOVE A DAY gets a
 * short window so the full JOIN → SUBMIT → COMPLETE → REWARD flow is
 * experienceable; the others run on their named horizons.
 */
const PLATFORM_CHALLENGES = [
  {
    title: "7 DAY GROOVE",
    description:
      "Seven days, seven grooves. Film one groove a day for a week and submit your best take. Consistency beats perfection — the groove is the goal.",
    rules: "One video per day · any style · original movement only · submit your best single take before the deadline.",
    style: "All styles",
    difficulty: "beginner" as const,
    days: 7,
    reward: { xp: 250, credits: 5, badgeCode: "challenger" },
  },
  {
    title: "30 DAY DANCE",
    description:
      "The full-month commitment. Dance every day for 30 days — the feed is your practice log. Finishers earn the CONSISTENT track and a platform badge.",
    rules: "Practice or submit daily · any style · completion requires at least one cleared video submission.",
    style: "All styles",
    difficulty: "intermediate" as const,
    days: 30,
    reward: { xp: 400, credits: 8 },
  },
  {
    title: "MASTER THIS COMBO",
    description:
      "This cycle's 8-count combo from the Learn catalog. Learn it, clean it, film it front-on. Cleanest execution wins the spotlight.",
    rules: "Use the linked tutorial combo · film front-on · no cuts inside the 8-count.",
    style: "Hip Hop",
    difficulty: "intermediate" as const,
    days: 7,
    reward: { xp: 300, credits: 6, badgeCode: "combo_machine" },
  },
  {
    title: "ONE MOVE A DAY",
    description:
      "The daily spark. One move, one day, one take. A short-window flash challenge — join while it's live and land your submission before it closes.",
    rules: "Any single move · one take · window closes fast.",
    style: "All styles",
    difficulty: "beginner" as const,
    days: 0.002, // ~3 minutes: a flash challenge so the full loop is experienceable
    reward: { xp: 100, credits: 2 },
  },
] as const;

/** Idempotently seed platform challenge rows (probe by exact title). */
async function ensureChallengesSeed(db: any): Promise<void> {
  const now = Date.now();
  const existing = new Set(((await db.query("challenges").collect()) as any[]).map((r) => r.title as string));
  for (const c of PLATFORM_CHALLENGES) {
    if (existing.has(c.title)) continue;
    await db.insert("challenges", {
      title: c.title,
      description: c.description,
      rules: c.rules,
      style: c.style,
      difficulty: c.difficulty,
      startsAt: now - 60_000, // open now
      deadlineAt: now + Math.round(c.days * 86_400_000),
      participantCount: 0,
      safetyStatus: "cleared",
      status: "published",
      reward: c.reward,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Idempotent platform bootstrap (called once per app load by the client —
 * Convex queries cannot write, so seeding is a mutation): the achievements
 * catalog and the platform challenge rows.
 */
export const bootstrapPlatform = mutationGeneric({
  args: {},
  handler: async (ctx: any) => {
    await ensureAchievementsSeed(ctx.db);
    await ensureChallengesSeed(ctx.db);
    return { ok: true as const };
  },
});

/**
 * The public challenge catalog: published rows merged with the client seed
 * challenges (ch1–ch4) so existing UI keeps working. Guest-safe.
 */
export const listChallenges = queryGeneric({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const rows = (await ctx.db.query("challenges").collect()) as any[];
    const visible = rows.filter(
      (r) => r.status === "published" || r.studioStatus === "published"
    );
    const caller = args.sessionToken ? await requireCaller(ctx.db, args.sessionToken) : null;
    const out = [];
    for (const r of visible) out.push(await projectChallenge(ctx.db, r, caller?.userId ?? null, now));
    return { ok: true as const, challenges: out };
  },
});

/** One challenge page (guest-safe; viewer state included when signed in). */
export const getChallenge = queryGeneric({
  args: { challengeId: v.string(), sessionToken: v.optional(v.string()) },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const row = (await ctx.db.get(args.challengeId as never)) as any;
    if (!row || (row.status !== "published" && row.studioStatus !== "published")) {
      return { ok: false as const, error: "not_found" as const };
    }
    const caller = args.sessionToken ? await requireCaller(ctx.db, args.sessionToken) : null;
    return {
      ok: true as const,
      challenge: await projectChallenge(ctx.db, row, caller?.userId ?? null, now),
      // Submissions for the leaderboard/entries grid (cleared only — safety-gated).
      submissions: (
        (await ctx.db
          .query("challengeSubmissions")
          .withIndex("by_challenge", (q: any) => q.eq("challengeId", row._id))
          .collect()) as any[]
      )
        .filter((s) => s.status === "cleared")
        .map((s) => ({
          id: String(s._id),
          userId: String(s.userId),
          postId: String(s.postId),
          progressPct: s.progressPct as number,
          createdAt: s.createdAt as number,
        })),
    };
  },
});

/** Achievements for a profile (self or public viewer-safe projection). */
export const listAchievements = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx: any, args: any) => {
    const rows = (await ctx.db
      .query("userAchievements")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .collect()) as any[];
    return {
      ok: true as const,
      achievements: rows
        .filter((r) => r.unlockedAt)
        .map((r) => ({
          code: r.achievementId as string,
          unlockedAt: r.unlockedAt as number,
        })),
    };
  },
});

/* ------------------------------ mutations ------------------------------ */

/** JOIN — creates the participant row (anti-double-count source of truth). */
export const joinChallenge = mutationGeneric({
  args: { sessionToken: v.string(), challengeId: v.string() },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const row = (await ctx.db.get(args.challengeId as never)) as any;
    const phase = phaseOf(row ?? {}, now);
    const existing = await myParticipation(ctx.db, args.challengeId, c.userId);
    const decision = decideJoin({
      signedIn: true,
      challenge: row ?? null,
      alreadyJoined: Boolean(existing),
      phase,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error as never };

    await ctx.db.insert("challengeParticipants", {
      challengeId: args.challengeId as never,
      userId: c.userId as never,
      joinedAt: now,
    });
    await ctx.db.patch(row._id as never, { participantCount: (row.participantCount ?? 0) + 1 } as never);
    await ctx.db.insert("auditLogs", {
      actorUserId: c.userId as never,
      eventType: "challenge_event",
      targetType: "challenge",
      targetId: args.challengeId,
      summary: "challenge_joined",
      createdAt: now,
    });
    return { ok: true as const, joined: true as const };
  },
});

/**
 * SUBMIT — link one of the caller's own published posts as their entry.
 * One submission per (challenge, user); the post ownership/publication is
 * verified server-side. The submission itself goes through safety review
 * (pending → cleared) exactly like a post.
 */
export const submitChallengeEntry = mutationGeneric({
  args: { sessionToken: v.string(), challengeId: v.string(), postId: v.string() },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const row = (await ctx.db.get(args.challengeId as never)) as any;
    const phase = phaseOf(row ?? {}, now);
    const participation = await myParticipation(ctx.db, args.challengeId, c.userId);
    const existingSub = await mySubmission(ctx.db, args.challengeId, c.userId);
    const post = (await ctx.db.get(args.postId as never)) as any;
    const decision = decideSubmit({
      signedIn: true,
      challenge: row ?? null,
      joined: Boolean(participation),
      phase,
      post: post ? { userId: String(post.userId), status: post.status as string } : null,
      callerUserId: c.userId,
      alreadySubmitted: Boolean(existingSub),
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error as never };

    await ctx.db.insert("challengeSubmissions", {
      challengeId: args.challengeId as never,
      userId: c.userId as never,
      postId: args.postId as never,
      progressPct: 100,
      status: "pending", // safety screening (mirrors posts)
      createdAt: now,
    });

    // Keep the participant row's entry pointer fresh (leaderboard convenience).
    if (participation) {
      await ctx.db.patch(participation._id as never, { entryPostId: args.postId as never } as never);
    }
    await ctx.db.insert("auditLogs", {
      actorUserId: c.userId as never,
      eventType: "challenge_event",
      targetType: "challenge",
      targetId: args.challengeId,
      summary: "challenge_submission_created",
      createdAt: now,
    });
    return { ok: true as const, submitted: true as const };
  },
});

/**
 * COMPLETE — pay the challenge reward once. Requires a **cleared**
 * submission and the window closed. Rewards: challenge-defined XP/credits
 * (configurable fallbacks) + optional badge (achievement code) + the
 * participant's entry in achievement evaluation (`challenger`, etc.).
 */
export const completeChallenge = mutationGeneric({
  args: { sessionToken: v.string(), challengeId: v.string() },
  handler: async (ctx: any, args: any) => {
    const now = Date.now();
    const c = await requireCaller(ctx.db, args.sessionToken);
    if (!c) return { ok: false as const, error: "unauthenticated" as const };

    const row = (await ctx.db.get(args.challengeId as never)) as any;
    const phase = phaseOf(row ?? {}, now);
    const participation = await myParticipation(ctx.db, args.challengeId, c.userId);
    const sub = await mySubmission(ctx.db, args.challengeId, c.userId);
    const alreadyPaid = await alreadyCompletedOnLedger(ctx.db, c.userId, args.challengeId);
    const decision = decideComplete({
      signedIn: true,
      challenge: row ?? null,
      joined: Boolean(participation),
      phase,
      submission: sub ? { status: sub.status as string } : null,
      alreadyPaid,
    });
    if (decision.action === "deny") return { ok: false as const, error: decision.error as never };

    // Rewards — every path idempotent, so re-calls can never double-pay:
    //  1. XP through the Day 9 arcade ledger (refId = challenge id; the
    //     shared helper also pays the challenge credits — one grant ever),
    //  2. the badge as a direct achievement award (already-owned probe).
    const xp = await grantActivityXp(ctx.db, c.userId, c.userStatus, "challenge_complete", args.challengeId, now, {
      xp: decision.xp, // challenge-defined XP (fallback 250 — see core)
      credits: decision.credits, // challenge-defined credits (fallback 2)
    });
    const credits = xp.creditsGranted ?? 0;
    let badgeGranted = false;
    if (decision.badgeCode) {
      badgeGranted = await awardBadge(ctx.db, c.userId, decision.badgeCode, now);
    }
    // Challenge completions feed the achievement evaluator ("challenger" —
    // first challenge; the completion XP is already on the ledger).
    const stats = await statsFor(ctx.db, c.userId);
    const newAchievements = await evaluateAchievements(ctx.db, c.userId, c.userStatus, stats, now);
    await ctx.db.insert("auditLogs", {
      actorUserId: c.userId as never,
      eventType: "challenge_event",
      targetType: "challenge",
      targetId: args.challengeId,
      summary: `challenge_completed; xp:${xp.granted}; credits:${credits}; badge:${badgeGranted ? decision.badgeCode : "-"}`,
      createdAt: now,
    });
    return {
      ok: true as const,
      completed: true as const,
      xpGranted: xp.granted,
      creditsGranted: credits,
      badgeCode: decision.badgeCode,
      badgeGranted,
      newAchievements,
    };
  },
});
