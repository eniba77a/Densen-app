/**
 * DENSEN — Teacher Studio wire layer (Day 8, Day 23 update).
 * ==========================================================
 * Every call re-derives identity from the SESSION TOKEN and re-runs the
 * `studio.ts` decision core. Nothing below trusts client-asserted identity,
 * role, or ownership.
 *
 * Day 23 — FREE PLATFORM: the platform no longer sells anything. Every
 * create/update coerces the item to priceCents 0 / creditPrice 0 (no paid
 * content can be created anymore) and legacy purchase-derived "student"
 * counts were replaced with real lesson-engagement counts from
 * `lessonProgress`. New capabilities: item deletion (owner/admin), optional
 * teacher movement timestamps (`steps`), and uploaded lesson-video refs
 * (ownership-checked against the `videos` table).
 */
import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { callerFromToken } from "./content";
import { scanVideoSubmissionCore } from "./safetyCore";
import {
  decidePublishTransition,
  decideStudioAccess,
  decideStudioEdit,
  normalizeSteps,
  splitRevenue,
  validateStudioItem,
  MAX_TITLE,
  type StudioCaller,
  type StudioDifficulty,
  type StudioKind,
  type StudioVisibility,
} from "./studio";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

interface StudioCtx {
  db: Db;
  storage?: any;
}

/** Session token → caller + verified-teacher row (or null). Fail-closed. */
async function studioCaller(db: Db, sessionToken: string) {
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;
  const teacherRow = (
    await db.query("teacherProfiles").withIndex("userId", (q: any) => q.eq("userId", caller.userId)).unique()
  ) as { status: "pending" | "verified" | "rejected" | "revoked"; revenueSharePct?: number } | null;
  const sc: StudioCaller = {
    userId: caller.userId,
    role: caller.role,
    userStatus: caller.userStatus,
  };
  const access = decideStudioAccess(sc, teacherRow);
  if (!access.allowed) return { caller: sc, teacherRow, denied: access.error as string };
  return { caller: sc, teacherRow, denied: null, isStaff: access.isStaff };
}

/** All six tables share the studio field shape; route kind → table. */
const KIND_TABLE: Record<StudioKind, string> = {
  move: "moves",
  combo: "combos",
  choreography: "choreographies",
  class: "classes",
  course: "courses",
  challenge: "challenges",
};

/** Core item fields every kind carries (schema-validated ranges in studio.ts). */
function itemFields(args: any) {
  return {
    description: args.description,
    style: args.style,
    difficulty: args.difficulty as StudioDifficulty,
    durationSec: args.durationSec,
    priceCents: args.priceCents,
    creditPrice: args.creditPrice,
    tags: args.tags,
    visibility: args.visibility as StudioVisibility,
    videoRef: args.videoRef,
    thumbnailRef: args.thumbnailRef,
    updatedAt: Date.now(),
  };
}

function validateArgs(args: any) {
  return validateStudioItem({
    title: args.title,
    description: args.description,
    style: args.style,
    difficulty: args.difficulty,
    durationSec: args.durationSec,
    priceCents: 0, // Day 23: free platform — pricing is coerced before validation
    creditPrice: 0,
    tags: args.tags,
    visibility: args.visibility,
    kind: args.kind,
    ...(args.kind === "challenge" ? { deadlineAt: args.deadlineAt } : {}),
  });
}

/**
 * Day 23 — uploaded-video reference guard. `videoRef` must point at a row of
 * the `videos` table the CALLER owns and that finished processing (or be a
 * legacy http(s) URL). Prevents grafting someone else's upload onto your
 * lesson and prevents half-uploaded assets from being published.
 */
async function videoRefError(ctx: StudioCtx, videoRef: string | undefined, userId: string): Promise<string | null> {
  if (!videoRef) return null;
  if (/^https?:\/\//i.test(videoRef)) return null; // legacy external URL passthrough
  const v = (await ctx.db.get(videoRef as never)) as { ownerUserId?: string; processingStatus?: string } | null;
  if (!v || v.ownerUserId !== userId) return "video_not_owned";
  if ((v.processingStatus ?? "ready") !== "ready") return "video_not_ready";
  return null;
}

/* ------------------------------------------------------------------ */
/*                        create (verified teachers)                   */
/* ------------------------------------------------------------------ */

export const createStudioItem = mutationGeneric({
  args: {
    sessionToken: v.string(),
    kind: v.union(
      v.literal("move"),
      v.literal("combo"),
      v.literal("choreography"),
      v.literal("class"),
      v.literal("course"),
      v.literal("challenge")
    ),
    title: v.string(),
    description: v.string(),
    style: v.string(),
    difficulty: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
    durationSec: v.number(),
    priceCents: v.number(),
    creditPrice: v.number(),
    tags: v.array(v.string()),
    visibility: v.union(v.literal("public"), v.literal("followers"), v.literal("private")),
    videoRef: v.optional(v.string()),
    thumbnailRef: v.optional(v.string()),
    deadlineAt: v.optional(v.number()), // challenges only
    comboMoveIds: v.optional(v.array(v.id("moves"))), // combos only
    steps: v.optional(v.array(v.object({ label: v.string(), atSec: v.number() }))), // Day 23 teacher timestamps
  },
  handler: async (ctx: StudioCtx, args: any) => {
    const now = Date.now();
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s) return { ok: false as const, error: "unauthenticated" as const };
    if (s.denied) return { ok: false as const, error: s.denied };

    // Day 23 — FREE PLATFORM: client-sent pricing is ignored; every new item
    // is free. Old rows keep their legacy price fields as historical data.
    args.priceCents = 0;
    args.creditPrice = 0;

    const check = validateArgs(args);
    if (!check.ok) return { ok: false as const, error: check.error };

    // Day 23 — optional movement timestamps (validated + chronologically sorted).
    const stepsVal = normalizeSteps(args.steps);
    if (!stepsVal.ok) return { ok: false as const, error: stepsVal.error };

    // Day 23 — uploaded videos must belong to the caller and be ready.
    const vidErr = await videoRefError(ctx, args.videoRef, s.caller.userId);
    if (vidErr) return { ok: false as const, error: vidErr as never };

    const teacherId = s.caller.userId;
    const base = { ...itemFields(args), teacherId };

    let id: string;
    if (args.kind === "move") {
      id = (await ctx.db.insert("moves", {
        name: args.title.trim(),
        createdAt: now,
        ...base,
        status: "draft" as const,
      })) as string;
    } else if (args.kind === "combo") {
      // Referenced moves must exist AND belong to this teacher (no cross-owner grafts).
      const moveIds: string[] = args.comboMoveIds ?? [];
      for (const mid of moveIds) {
        const m = await ctx.db.get(mid as never);
        if (!m || m.teacherId !== teacherId) return { ok: false as const, error: "move_not_owned" as const };
      }
      id = (await ctx.db.insert("combos", {
        name: args.title.trim(),
        moveIds,
        createdAt: now,
        ...base,
        status: "draft" as const,
      })) as string;
    } else if (args.kind === "choreography") {
      id = (await ctx.db.insert("choreographies", {
        authorId: teacherId as never,
        title: args.title.trim(),
        status: "in_review" as never, // moderation-facing status mirrors draft
        createdAt: now,
        ...base,
        studioStatus: "draft" as const,
      })) as string;
    } else if (args.kind === "class") {
      id = (await ctx.db.insert("classes", {
        teacherId: teacherId as never,
        title: args.title.trim(),
        status: "draft" as never,
        createdAt: now,
        ...itemFields(args),
        steps: stepsVal.steps.length > 0 ? stepsVal.steps : undefined,
        coverUrl: args.thumbnailRef ?? "",
        altText: `Class cover for ${args.title.trim()}`,
        updatedAt: now,
      })) as string;
    } else if (args.kind === "course") {
      id = (await ctx.db.insert("courses", {
        teacherId: teacherId as never,
        title: args.title.trim(),
        currency: "EUR",
        status: "draft" as never,
        createdAt: now,
        ...itemFields(args),
        coverUrl: args.thumbnailRef ?? "",
        altText: `Course cover for ${args.title.trim()}`,
        updatedAt: now,
      })) as string;
    } else {
      // Challenge: safety scan of title+description decides clearance.
      const scan = scanVideoSubmissionCore({
        caption: `${args.title}\n${args.description}`,
        hashtags: args.tags,
        audioLicensed: true, // challenge rules text, not commercial audio
        creatorIsMinor: false, // teachers are adults by definition (Day 2)
      });
      if (scan.status === "blocked") return { ok: false as const, error: "safety_blocked" as const };
      id = (await ctx.db.insert("challenges", {
        title: args.title.trim(),
        deadlineAt: args.deadlineAt,
        participantCount: 0,
        safetyStatus: scan.status === "in_review" ? "flagged" : "cleared",
        status: "in_review" as never,
        createdAt: now,
        teacherId: teacherId as never,
        studioStatus: "draft" as const,
        ...itemFields(args),
        updatedAt: now,
      })) as string;
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: teacherId as never,
      actorRole: s.caller.role,
      eventType: "content_event",
      targetType: args.kind,
      targetId: id,
      summary: `studio_create_${args.kind}_draft`,
      createdAt: now,
    });
    return { ok: true as const, id, accessModel: check.accessModel };
  },
});

/* ------------------------------------------------------------------ */
/*                     edit + lifecycle (owner/admin)                  */
/* ------------------------------------------------------------------ */

async function loadOwnedItem(ctx: StudioCtx, s: NonNullable<Awaited<ReturnType<typeof studioCaller>>>, _kind: StudioKind, id: string) {
  const row = await ctx.db.get(id as never);
  if (!row) return { error: "not_found" as const };
  const ownerId: string | undefined = row.teacherId ?? row.authorId;
  if (!ownerId) return { error: "not_found" as const };
  const edit = decideStudioEdit(s.caller, ownerId);
  if (!edit.ok) return { error: edit.error };
  return { row };
}

export const updateStudioItem = mutationGeneric({
  args: {
    sessionToken: v.string(),
    kind: v.union(
      v.literal("move"),
      v.literal("combo"),
      v.literal("choreography"),
      v.literal("class"),
      v.literal("course"),
      v.literal("challenge")
    ),
    itemId: v.string(),
    title: v.string(),
    description: v.string(),
    style: v.string(),
    difficulty: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
    durationSec: v.number(),
    priceCents: v.number(),
    creditPrice: v.number(),
    tags: v.array(v.string()),
    visibility: v.union(v.literal("public"), v.literal("followers"), v.literal("private")),
    videoRef: v.optional(v.string()),
    thumbnailRef: v.optional(v.string()),
    deadlineAt: v.optional(v.number()),
    comboMoveIds: v.optional(v.array(v.id("moves"))),
    steps: v.optional(v.array(v.object({ label: v.string(), atSec: v.number() }))), // Day 23 teacher timestamps
  },
  handler: async (ctx: StudioCtx, args: any) => {
    const now = Date.now();
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s) return { ok: false as const, error: "unauthenticated" as const };
    if (s.denied) return { ok: false as const, error: s.denied };

    // Day 23 — FREE PLATFORM: pricing is coerced to free on every update too.
    args.priceCents = 0;
    args.creditPrice = 0;

    const check = validateArgs(args);
    if (!check.ok) return { ok: false as const, error: check.error };

    // Day 23 — movement timestamps: "absent" keeps the stored value so a
    // plain text edit never silently wipes the teacher's timestamps; an
    // explicitly EMPTY array clears them (the UI always sends the full list
    // for class edits).
    let steps: { label: string; atSec: number }[] | undefined;
    let stepsTouched = false;
    if (args.steps !== undefined) {
      stepsTouched = true;
      const stepsVal = normalizeSteps(args.steps);
      if (!stepsVal.ok) return { ok: false as const, error: stepsVal.error };
      steps = stepsVal.steps.length > 0 ? stepsVal.steps : undefined;
    }

    const loaded = await loadOwnedItem(ctx, s, args.kind as StudioKind, args.itemId);
    if ("error" in loaded) return { ok: false as const, error: loaded.error };

    // Day 23 — video guard only when the ref CHANGES (legacy refs re-validate
    // against the same rules they were written under).
    if (args.videoRef !== undefined && args.videoRef !== (loaded.row as { videoRef?: string }).videoRef) {
      const vidErr = await videoRefError(ctx, args.videoRef, s.caller.userId);
      if (vidErr) return { ok: false as const, error: vidErr as never };
    }
    if (args.kind === "move") {
      await ctx.db.patch(loaded.row._id as never, { name: args.title.trim(), ...itemFields(args) });
    } else if (args.kind === "combo") {
      const moveIds: string[] = args.comboMoveIds ?? [];
      for (const mid of moveIds) {
        const m = await ctx.db.get(mid as never);
        if (!m || m.teacherId !== s.caller.userId) return { ok: false as const, error: "move_not_owned" as const };
      }
      await ctx.db.patch(loaded.row._id as never, { name: args.title.trim(), moveIds, ...itemFields(args) });
    } else if (args.kind === "choreography") {
      await ctx.db.patch(loaded.row._id as never, { title: args.title.trim(), ...itemFields(args) });
    } else if (args.kind === "class" || args.kind === "course") {
      await ctx.db.patch(loaded.row._id as never, {
        title: args.title.trim(),
        ...itemFields(args),
        ...(args.kind === "class" && stepsTouched ? { steps } : {}),
        coverUrl: args.thumbnailRef ?? loaded.row.coverUrl ?? "",
      });
    } else {
      await ctx.db.patch(loaded.row._id as never, {
        title: args.title.trim(),
        deadlineAt: args.deadlineAt,
        ...itemFields(args),
      });
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: s.caller.userId as never,
      actorRole: s.caller.role,
      eventType: "content_event",
      targetType: args.kind,
      targetId: args.itemId,
      summary: "studio_update",
      createdAt: now,
    });
    return { ok: true as const };
  },
});

export const transitionStudioItem = mutationGeneric({
  args: {
    sessionToken: v.string(),
    kind: v.union(
      v.literal("move"),
      v.literal("combo"),
      v.literal("choreography"),
      v.literal("class"),
      v.literal("course"),
      v.literal("challenge")
    ),
    itemId: v.string(),
    action: v.union(v.literal("publish"), v.literal("unpublish"), v.literal("revert_to_draft")),
  },
  handler: async (ctx: StudioCtx, args: any) => {
    const now = Date.now();
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s) return { ok: false as const, error: "unauthenticated" as const };
    if (s.denied) return { ok: false as const, error: s.denied };

    const loaded = await loadOwnedItem(ctx, s, args.kind as StudioKind, args.itemId);
    if ("error" in loaded) return { ok: false as const, error: loaded.error };

    // Choreographies/challenges carry the moderation-facing `status`; studio
    // lifecycle lives in studioStatus. Moves/combos use `status` directly.
    const statusField = args.kind === "choreography" || args.kind === "challenge" ? "studioStatus" : "status";
    const current: string = loaded.row[statusField] ?? loaded.row.studioStatus ?? "draft";
    const t = decidePublishTransition(current as never, args.action);
    if (!t.ok) return { ok: false as const, error: t.error };

    if (args.kind === "choreography" || args.kind === "challenge") {
      const patch: Record<string, unknown> = { studioStatus: t.next, updatedAt: now };
      // Mirror into the moderation-facing status so safety queues stay coherent:
      patch.status = t.next === "published" ? "published" : t.next === "unpublished" ? "removed" : "in_review";
      await ctx.db.patch(loaded.row._id as never, patch as never);
    } else {
      await ctx.db.patch(loaded.row._id as never, { status: t.next, updatedAt: now } as never);
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: s.caller.userId as never,
      actorRole: s.caller.role,
      eventType: "content_event",
      targetType: args.kind,
      targetId: args.itemId,
      summary: `studio_${args.action}`,
      createdAt: now,
    });
    return { ok: true as const, status: t.next };
  },
});

/* ------------------------------------------------------------------ */
/*                          studio queries                             */
/* ------------------------------------------------------------------ */

/**
 * Day 23 — delete one of the teacher's OWN items. Same ownership rule as
 * edit (`decideStudioEdit` inside loadOwnedItem: owner or admin). For a
 * course, its lesson rows and the per-user progress rows tied to them are
 * removed with it (dependent data of the deleted content). Every deletion
 * is audit-logged.
 */
export const deleteStudioItem = mutationGeneric({
  args: {
    sessionToken: v.string(),
    kind: v.union(
      v.literal("move"),
      v.literal("combo"),
      v.literal("choreography"),
      v.literal("class"),
      v.literal("course"),
      v.literal("challenge")
    ),
    itemId: v.string(),
  },
  handler: async (ctx: StudioCtx, args: any) => {
    const now = Date.now();
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s) return { ok: false as const, error: "unauthenticated" as const };
    if (s.denied) return { ok: false as const, error: s.denied };

    const loaded = await loadOwnedItem(ctx, s, args.kind as StudioKind, args.itemId);
    if ("error" in loaded) return { ok: false as const, error: loaded.error };

    // Course kind: remove the course's lessons + the per-user progress rows
    // tied to it (dependent state of the deleted content).
    if (args.kind === "course") {
      const lessons = (await ctx.db
        .query("lessons")
        .withIndex("by_course_pos", (q: any) => q.eq("courseId", args.itemId))
        .collect()) as { _id: string }[];
      const progress = (await ctx.db
        .query("lessonProgress")
        .withIndex("by_course", (q: any) => q.eq("courseKey", args.itemId))
        .collect()) as { _id: string }[];
      for (const p of progress) await ctx.db.delete(p._id as never);
      for (const l of lessons) await ctx.db.delete(l._id as never);
    }

    await ctx.db.delete(loaded.row._id as never);
    await ctx.db.insert("auditLogs", {
      actorUserId: s.caller.userId as never,
      actorRole: s.caller.role,
      eventType: "content_event",
      targetType: args.kind,
      targetId: args.itemId,
      summary: `studio_delete_${args.kind}`,
      createdAt: now,
    });
    return { ok: true as const };
  },
});

function projectItem(row: any, kind: StudioKind) {
  const status: string = row.studioStatus ?? row.status ?? "draft";
  return {
    id: row._id,
    kind,
    title: row.title ?? row.name ?? "",
    description: row.description ?? "",
    style: row.style ?? "",
    difficulty: row.difficulty ?? "beginner",
    durationSec: row.durationSec ?? 0,
    priceCents: 0, // Day 23: free platform — the legacy fields are no longer surfaced
    creditPrice: 0,
    tags: row.tags ?? [],
    visibility: row.visibility ?? "private",
    videoRef: row.videoRef ?? row.breakdownUrl ?? undefined,
    thumbnailRef: row.thumbnailRef ?? undefined,
    steps: row.steps ?? [],
    status: status === "in_review" ? "draft" : status === "removed" ? "unpublished" : status,
    deadlineAt: row.deadlineAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  };
}

export const listMyItems = queryGeneric({
  args: {
    sessionToken: v.string(),
    kind: v.optional(
      v.union(
        v.literal("move"),
        v.literal("combo"),
        v.literal("choreography"),
        v.literal("class"),
        v.literal("course"),
        v.literal("challenge")
      )
    ),
  },
  handler: async (ctx: StudioCtx, args: any) => {
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s || s.denied) return { ok: false as const, error: s?.denied ?? "unauthenticated" };

    const kinds: StudioKind[] = args.kind ? [args.kind] : ["move", "combo", "choreography", "class", "course", "challenge"];
    const out: ReturnType<typeof projectItem>[] = [];
    for (const k of kinds) {
      const table = KIND_TABLE[k];
      const ownerField = k === "choreography" ? "authorId" : "teacherId";
      const rows = (await ctx.db
        .query(table)
        .withIndex(ownerField === "authorId" ? "authorId" : "by_teacher", (q: any) => q.eq(ownerField, s.caller.userId))
        .collect()) as any[];
      for (const r of rows) out.push(projectItem(r, k));
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);

    // Day 23 — resolve playable URLs for the teacher's own uploaded videos
    // (preview before publish). Owner-only query, so no extra gate needed.
    const items = [] as (ReturnType<typeof projectItem> & { videoUrl?: string })[];
    for (const it of out) {
      if (it.videoRef && !/^https?:\/\//i.test(it.videoRef)) {
        const v = (await ctx.db.get(it.videoRef as never)) as { storageRef?: string } | null;
        const url = v?.storageRef ? await ctx.storage?.getUrl?.(v.storageRef as never) : undefined;
        items.push({ ...it, videoUrl: typeof url === "string" ? url : undefined });
      } else if (it.videoRef) {
        items.push({ ...it, videoUrl: it.videoRef });
      } else {
        items.push(it);
      }
    }
    return { ok: true as const, items };
  },
});

export const getStudioOverview = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: StudioCtx, args: any) => {
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s || s.denied) return { ok: false as const, error: s?.denied ?? "unauthenticated" };

    const counts = { moves: 0, combos: 0, choreographies: 0, classes: 0, courses: 0, challenges: 0, published: 0, drafts: 0 };
    const kindTable: [StudioKind, keyof typeof counts][] = [
      ["move", "moves"],
      ["combo", "combos"],
      ["choreography", "choreographies"],
      ["class", "classes"],
      ["course", "courses"],
      ["challenge", "challenges"],
    ];
    let studentsSet = new Set<string>();
    for (const [k, key] of kindTable) {
      const ownerField = k === "choreography" ? "authorId" : "teacherId";
      const rows = (await ctx.db
        .query(KIND_TABLE[k])
        .withIndex(ownerField === "authorId" ? "authorId" : "by_teacher", (q: any) => q.eq(ownerField, s.caller.userId))
        .collect()) as any[];
      counts[key] = rows.length;
      for (const r of rows) {
        const st = r.studioStatus ?? r.status;
        if (st === "published") counts.published++;
        else counts.drafts++;
      }
    }
    // Day 23 — Students = distinct LEARNERS of my courses/classes, counted
    // from real lesson engagement (lessonProgress). The old purchase-based
    // count died with the payment system; engagement is the honest metric.
    const myCourses = (await ctx.db
      .query("courses")
      .withIndex("by_teacher", (q: any) => q.eq("teacherId", s.caller.userId))
      .collect()) as any[];
    const myClasses = (await ctx.db
      .query("classes")
      .withIndex("by_teacher", (q: any) => q.eq("teacherId", s.caller.userId))
      .collect()) as any[];
    const contentIds = [...myCourses.map((c) => c._id as string), ...myClasses.map((c) => c._id as string)];
    for (const cid of contentIds) {
      const learners = (await ctx.db
        .query("lessonProgress")
        .withIndex("by_course", (q: any) => q.eq("courseKey", cid))
        .collect()) as { userId: string }[];
      for (const l of learners) studentsSet.add(l.userId);
    }
    const students = studentsSet.size;
    studentsSet = new Set();

    return {
      ok: true as const,
      counts,
      students,
      revenueSharePct: s.teacherRow?.revenueSharePct ?? undefined,
    };
  },
});

/**
 * Revenue: read-only accrual truth. Rows are ONLY written by the future
 * payment-provider webhook when real money settles (see purchases module) —
 * this query invents nothing.
 */
export const getRevenue = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: StudioCtx, args: any) => {
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s || s.denied) return { ok: false as const, error: s?.denied ?? "unauthenticated" };

    const rows = (await ctx.db
      .query("teacherPayouts")
      .withIndex("by_teacher", (q: any) => q.eq("teacherUserId", s.caller.userId))
      .collect()) as any[];
    const sharePct = s.teacherRow?.revenueSharePct ?? 70;
    const accruingCents = rows.filter((r) => r.status === "accruing").reduce((sum, r) => sum + r.amountCents, 0);
    const scheduledCents = rows.filter((r) => r.status === "scheduled").reduce((sum, r) => sum + r.amountCents, 0);
    const paidCents = rows.filter((r) => r.status === "paid").reduce((sum, r) => sum + r.amountCents, 0);
    return {
      ok: true as const,
      sharePct,
      accruingCents,
      scheduledCents,
      paidCents,
      payouts: rows
        .map((r) => ({
          id: r._id,
          amountCents: r.amountCents,
          currency: r.currency,
          status: r.status,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          providerRef: r.providerRef,
        }))
        .sort((a, b) => b.periodStart - a.periodStart),
    };
  },
});

/** Analytics: per-item real engagement counts (no synthetic numbers). */
export const getAnalytics = queryGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx: StudioCtx, args: any) => {
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s || s.denied) return { ok: false as const, error: s?.denied ?? "unauthenticated" };

    const myCourses = (await ctx.db
      .query("courses")
      .withIndex("by_teacher", (q: any) => q.eq("teacherId", s.caller.userId))
      .collect()) as any[];
    const myClasses = (await ctx.db
      .query("classes")
      .withIndex("by_teacher", (q: any) => q.eq("teacherId", s.caller.userId))
      .collect()) as any[];
    // Day 23 — learners = real lesson engagement across my courses (the old
    // purchase-count metric is gone with the payment system).
    let enrollments = 0;
    for (const c of myCourses) {
      enrollments += ((await ctx.db
        .query("lessonProgress")
        .withIndex("by_course", (q: any) => q.eq("courseKey", c._id))
        .collect()) as unknown[]).length;
    }
    const myPosts = (await ctx.db
      .query("posts")
      .withIndex("by_user_status", (q: any) => q.eq("userId", s.caller.userId).eq("status", "published"))
      .collect()) as any[];
    const totals = myPosts.reduce(
      (acc, p) => ({
        likes: acc.likes + (p.likeCount ?? 0),
        comments: acc.comments + (p.commentCount ?? 0),
        views: acc.views + (p.viewCount ?? 0),
        practice: acc.practice + (p.practiceCount ?? 0),
      }),
      { likes: 0, comments: 0, views: 0, practice: 0 }
    );
    return {
      ok: true as const,
      enrollments,
      classesPublished: myClasses.filter((c) => c.status === "published").length,
      coursesPublished: myCourses.filter((c) => c.status === "published").length,
      ...totals,
    };
  },
});

/** Split preview for the Revenue tab (pure math, no fake totals). */
export const previewSplit = queryGeneric({
  args: { sessionToken: v.string(), amountCents: v.number() },
  handler: async (ctx: StudioCtx, args: any) => {
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s || s.denied) return { ok: false as const, error: s?.denied ?? "unauthenticated" };
    const sharePct = s.teacherRow?.revenueSharePct ?? 70;
    return { ok: true as const, sharePct, ...splitRevenue(Math.max(0, Math.round(args.amountCents)), sharePct) };
  },
});

/* ------------------------------------------------------------------ */
/*            course lessons (Day 7→8: course material authoring)      */
/* ------------------------------------------------------------------ */

/**
 * Append a lesson to one of the teacher's own courses. Lessons are the
 * material of a course — they publish/unpublish with it, so there is no
 * per-lesson lifecycle. Position is auto-assigned (max+1) and always kept
 * >= 1 so the class-page ordering is stable.
 */
export const createCourseLesson = mutationGeneric({
  args: {
    sessionToken: v.string(),
    courseId: v.string(),
    title: v.string(),
    description: v.optional(v.string()), // Day 8: shown on the lesson card
    durationSec: v.number(),
    xpReward: v.optional(v.number()),
    videoRef: v.optional(v.string()),
    steps: v.optional(v.array(v.object({ label: v.string(), atSec: v.number() }))), // Day 23
  },
  handler: async (ctx: StudioCtx, args: any) => {
    const now = Date.now();
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s) return { ok: false as const, error: "unauthenticated" as const };
    if (s.denied) return { ok: false as const, error: s.denied };

    const course = (await ctx.db.get(args.courseId as never)) as any;
    if (!course || course.teacherId !== s.caller.userId) return { ok: false as const, error: "not_found" as const };
    const title = String(args.title ?? "").trim();
    if (!title || title.length > MAX_TITLE) return { ok: false as const, error: "title_invalid" as const };
    if (!Number.isFinite(args.durationSec) || args.durationSec <= 0 || args.durationSec > 4 * 3600)
      return { ok: false as const, error: "duration_invalid" as const };

    // Day 23 — movement timestamps + uploaded-video ownership.
    const stepsVal = normalizeSteps(args.steps);
    if (!stepsVal.ok) return { ok: false as const, error: stepsVal.error as never };
    const vidErr = await videoRefError(ctx, args.videoRef, s.caller.userId);
    if (vidErr) return { ok: false as const, error: vidErr as never };

    const existing = (await ctx.db
      .query("lessons")
      .withIndex("by_course_pos", (q: any) => q.eq("courseId", args.courseId))
      .collect()) as any[];
    const position = existing.reduce((m, l) => Math.max(m, l.position ?? 0), 0) + 1;
    if (position > 200) return { ok: false as const, error: "too_many_lessons" as const };

    const id = (await ctx.db.insert("lessons", {
      courseId: args.courseId as never,
      position,
      title,
      description: args.description?.trim() || undefined,
      videoRef: args.videoRef,
      steps: stepsVal.steps.length > 0 ? stepsVal.steps : undefined,
      durationSec: Math.round(args.durationSec),
      xpReward: Math.max(0, Math.min(500, Math.round(args.xpReward ?? 150))),
      status: "published" as never, // course-gated visibility
      createdAt: now,
      updatedAt: now,
    })) as string;

    await ctx.db.insert("auditLogs", {
      actorUserId: s.caller.userId as never,
      actorRole: s.caller.role,
      eventType: "content_event",
      targetType: "lesson",
      targetId: id,
      summary: `studio_lesson_added:${args.courseId}`,
      createdAt: now,
    });
    return { ok: true as const, id, position };
  },
});

/** Owner-gated lesson list for the studio course manager (drafts included). */
export const listCourseLessons = queryGeneric({
  args: { sessionToken: v.string(), courseId: v.string() },
  handler: async (ctx: StudioCtx, args: any) => {
    const s = await studioCaller(ctx.db, args.sessionToken);
    if (!s || s.denied) return { ok: false as const, error: s?.denied ?? "unauthenticated" };
    const course = (await ctx.db.get(args.courseId as never)) as any;
    if (!course || course.teacherId !== s.caller.userId) return { ok: false as const, error: "not_found" as const };
    const rows = (await ctx.db
      .query("lessons")
      .withIndex("by_course_pos", (q: any) => q.eq("courseId", args.courseId))
      .collect()) as any[];
    rows.sort((a, b) => a.position - b.position);
    return {
      ok: true as const,
      lessons: rows.map((l) => ({
        id: l._id as string,
        position: l.position,
        title: l.title,
        description: l.description,
        durationSec: l.durationSec,
        xpReward: l.xpReward,
        videoRef: l.videoRef ?? undefined,
        steps: l.steps ?? [],
      })),
    };
  },
});
