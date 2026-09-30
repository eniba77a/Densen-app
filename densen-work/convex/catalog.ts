/**
 * DENSEN — Public Learn catalog (Day 7→8 bridge).
 * ================================================
 * The Studio (convex/studioWire.ts) is where verified teachers author
 * classes, courses and lessons. This module is the READ side that publishes
 * that work into the Learn catalog:
 *
 *   - `listPublishedCourses` — published courses + their lessons (ordered)
 *   - `listPublishedClasses` — published standalone classes
 *   - `getPublishedItem`     — one course or class by id, for the class page
 *
 * Safety/privacy rules:
 *   - Only rows with status "published" leave the database (fail-closed).
 *   - Teacher identity is projected from PUBLIC rows only (teacherProfiles
 *     displayName, users.handle) — no emails, no DOB, no PII.
 *   - Guests can browse the catalog; lesson *content access* is still gated
 *     by pricing on the class page and future purchase checks server-side.
 *
 * Lesson status is course-gated: lessons are material of their course, so
 * their visibility follows the course publication state — no per-lesson
 * publish ceremony.
 */
import { queryGeneric } from "convex/server";
import { v } from "convex/values";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/** Public teacher projection — everything a student may see about a teacher. */
async function teacherProjection(db: Db, teacherId: string) {
  const teacher = (await db.get(teacherId)) as
    | { _id: string; handle?: string; role?: string }
    | null;
  if (!teacher) return { id: teacherId, handle: "unknown", displayName: "Unknown Teacher", verified: false };
  const tp = (await db
    .query("teacherProfiles")
    .withIndex("userId", (q: any) => q.eq("userId", teacherId))
    .unique()) as { status?: string; displayName?: string } | null;
  return {
    id: teacherId,
    handle: teacher.handle ?? "unknown",
    displayName: tp?.displayName ?? teacher.handle ?? "Unknown Teacher",
    verified: tp?.status === "verified",
  };
}

function priceFields(row: any) {
  return {
    priceCents: row.priceCents ?? 0,
    creditPrice: row.creditPrice ?? 0,
    currency: row.currency ?? "EUR",
  };
}

/** Lessons of a course, position-ordered, with the fields the client renders. */
async function courseLessons(db: Db, courseId: string) {
  const rows = (await db
    .query("lessons")
    .withIndex("by_course_pos", (q: any) => q.eq("courseId", courseId))
    .collect()) as any[];
  return rows
    .sort((a, b) => a.position - b.position)
    .map((l, i) => ({
      id: l._id as string,
      position: l.position ?? i + 1,
      title: l.title,
      durationSec: l.durationSec ?? 0,
      xpReward: l.xpReward ?? 0,
      videoRef: l.videoRef ?? undefined,
    }));
}

/**
 * All published courses with their lesson lists. Reactive — the Learn page
 * subscribes and new teacher publications appear without a refresh.
 */
/** Published course row → catalog projection (with lessons). */
async function projectCourse(db: Db, r: any) {
  return {
    id: r._id as string,
    kind: "course" as const,
    title: r.title,
    description: r.description ?? "",
    style: r.style,
    difficulty: (r.difficulty ?? "beginner") as string,
    coverUrl: r.coverUrl ?? "",
    altText: r.altText ?? "Course cover",
    ...priceFields(r),
    createdAt: r.createdAt as number,
    teacher: await teacherProjection(db, r.teacherId),
    lessons: await courseLessons(db, r._id),
  };
}

/** Published class row → catalog projection (single session, no lessons). */
async function projectClass(db: Db, r: any) {
  return {
    id: r._id as string,
    kind: "class" as const,
    title: r.title,
    description: r.description ?? "",
    style: r.style,
    difficulty: (r.difficulty ?? "beginner") as string,
    coverUrl: r.coverUrl ?? "",
    altText: r.altText ?? "Class cover",
    durationSec: r.durationSec ?? 0,
    ...priceFields(r),
    createdAt: r.createdAt as number,
    teacher: await teacherProjection(db, r.teacherId),
  };
}

/** All published courses with their lesson lists. Reactive. */
export const listPublishedCourses = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db
      .query("courses")
      .filter((q: any) => q.eq(q.field("status"), "published"))
      .collect()) as any[];
    const out = [];
    for (const r of rows) out.push(await projectCourse(ctx.db, r));
    out.sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true as const, courses: out };
  },
});

/** All published standalone classes (single-session format). */
export const listPublishedClasses = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db
      .query("classes")
      .filter((q: any) => q.eq(q.field("status"), "published"))
      .collect()) as any[];
    const out = [];
    for (const r of rows) out.push(await projectClass(ctx.db, r));
    out.sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true as const, classes: out };
  },
});

/**
 * Combined feed for the Learn page: published courses (with lessons) and
 * standalone classes in one reactive subscription. Newest first.
 */
export const listPublishedAll = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const courseRows = (await ctx.db
      .query("courses")
      .filter((q: any) => q.eq(q.field("status"), "published"))
      .collect()) as any[];
    const classRows = (await ctx.db
      .query("classes")
      .filter((q: any) => q.eq(q.field("status"), "published"))
      .collect()) as any[];
    const out: (
      | Awaited<ReturnType<typeof projectCourse>>
      | Awaited<ReturnType<typeof projectClass>>
    )[] = [];
    for (const r of courseRows) out.push(await projectCourse(ctx.db, r));
    for (const r of classRows) out.push(await projectClass(ctx.db, r));
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  },
});

/**
 * One catalog item (course with lessons, or class) for the class page.
 * The `courses` and `classes` tables are separate id spaces; `courses` rows
 * are recognized by their `currency` field, which `classes` rows never carry.
 */
export const getPublishedItem = queryGeneric({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const row = (await ctx.db.get(args.id as never)) as any;
    if (!row || row.status !== "published") return { ok: false as const, error: "not_found" as const };

    const teacher = await teacherProjection(ctx.db, row.teacherId);
    if (row.currency !== undefined) {
      // courses row
      return {
        ok: true as const,
        kind: "course" as const,
        item: {
          id: row._id as string,
          kind: "course" as const,
          title: row.title,
          description: row.description ?? "",
          style: row.style,
          difficulty: (row.difficulty ?? "beginner") as string,
          coverUrl: row.coverUrl ?? "",
          altText: row.altText ?? "Course cover",
          ...priceFields(row),
          createdAt: row.createdAt as number,
          teacher,
          lessons: await courseLessons(ctx.db, row._id),
        },
      };
    }
    // classes row
    return {
      ok: true as const,
      kind: "class" as const,
      item: {
        id: row._id as string,
        kind: "class" as const,
        title: row.title,
        description: row.description ?? "",
        style: row.style,
        difficulty: (row.difficulty ?? "beginner") as string,
        coverUrl: row.coverUrl ?? "",
        altText: row.altText ?? "Class cover",
        durationSec: row.durationSec ?? 0,
        ...priceFields(row),
        createdAt: row.createdAt as number,
        teacher,
        lessons: [] as { id: string; position: number; title: string; durationSec: number; xpReward: number }[],
      },
    };
  },
});
