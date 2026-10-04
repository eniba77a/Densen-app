/**
 * DENSEN — Server catalog adapter (Day 8 bridge).
 * ===============================================
 * The Studio (verified teachers) publishes classes/courses into Convex rows;
 * `convex/catalog.ts` is the public read side. This module converts those rows
 * into the client Course/Lesson shapes the Learn surfaces already render, so
 * teacher publications appear in Learn next to the seed catalog without
 * touching the seed data.
 *
 * Identity: server rows carry Convex ids; the seed catalog uses strings like
 * "c_begin1". The two id spaces never collide, so merging is a plain concat.
 * Pricing for server items is derived from the row itself (same ladder as
 * convex/learning.ts, which studio validation enforces at write time).
 */
import type { Course, Lesson } from "./store";
import { type ClassPricing } from "./learning";
import { IMG, VID, AVATARS } from "./media";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Day 23 — a teacher-provided movement timestamp (practice player seeks to
 * `atSec` when the dancer taps the step).
 */
export interface ServerStep {
  label: string;
  atSec: number;
}

/** Published course row as returned by convex/catalog.ts. */
export interface ServerCourseItem {
  id: string;
  kind: "course";
  title: string;
  description: string;
  style: string;
  difficulty: string;
  coverUrl: string;
  priceCents: number;
  creditPrice: number;
  createdAt: number;
  teacher: { id: string; handle: string; displayName: string; verified: boolean };
  lessons: { id: string; position: number; title: string; durationSec: number; xpReward: number; videoUrl?: string; steps?: ServerStep[] }[];
}

/** Published standalone class row (no lessons — one session). */
export interface ServerClassItem {
  id: string;
  kind: "class";
  title: string;
  description: string;
  style: string;
  difficulty: string;
  coverUrl: string;
  durationSec: number;
  priceCents: number;
  creditPrice: number;
  videoUrl?: string;
  steps?: ServerStep[];
  createdAt: number;
  teacher: { id: string; handle: string; displayName: string; verified: boolean };
}

export type ServerCatalogItem = ServerCourseItem | ServerClassItem;

const FALLBACK_COVERS: Record<string, string> = {
  "Hip-Hop": IMG.catHipHop,
  "Commercial": IMG.catCommercial,
  "Contemporary": IMG.catContemporary,
  "Jazz": IMG.catJazz,
  "Latin": IMG.catLatin,
  "Kids": IMG.catKids,
  "Beginner": IMG.catBeginners,
  "Teens": IMG.catTeens,
  "Advanced": IMG.catAdvanced,
  "Professional": IMG.catProfessional,
};

const coverFor = (row: { coverUrl: string; style: string }) =>
  row.coverUrl && row.coverUrl.startsWith("http")
    ? row.coverUrl
    : FALLBACK_COVERS[row.style] ?? IMG.catStudio;

const levelOf = (difficulty: string): Course["level"] =>
  difficulty === "advanced" ? "Advanced" : difficulty === "intermediate" ? "Intermediate" : "Beginner";

/** Studio style vocabulary is the same as the Learn categories. */
const styleLabel = (style: string) => (style === "Hip-Hop" ? "Hip Hop" : style);

/**
 * Day 23 — teacher steps become seekable lesson moves: `timing` shows the
 * timestamp and `atSec` lets the practice player seek to it. Legacy rows
 * without steps keep the empty list (the player hides the section).
 */
const movesOf = (steps: ServerStep[] | undefined): Lesson["moves"] =>
  (steps ?? []).map((s) => ({
    name: s.label,
    timing: formatAtSec(s.atSec),
    tip: "",
    atSec: s.atSec,
  }));

/** 62 → "1:02" (timestamp chip label for teacher steps). */
export const formatAtSec = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const lessonsOf = (row: ServerCourseItem): Lesson[] =>
  row.lessons.map((l) => ({
    id: l.id,
    title: l.title,
    dur: Math.max(1, Math.round(l.durationSec / 60)),
    // Day 23 — real uploaded videos resolve to a storage URL server-side;
    // the seed clip remains the fallback for lessons without an upload.
    video: l.videoUrl || VID.landscapeB,
    moves: movesOf(l.steps),
    desc: "",
  }));

/** Server course row → client Course (the shape Learn/CourseDetail render). */
export function serverCourseToCourse(row: ServerCourseItem): Course {
  return {
    id: row.id,
    title: row.title,
    teacherId: row.teacher.id,
    style: styleLabel(row.style),
    level: levelOf(row.difficulty),
    cover: coverFor(row),
    lessons: lessonsOf(row),
    enrolled: 0,
    rating: 0,
    about: row.description || row.title,
    isNew: true,
    trailer: VID.landscapeB,
  };
}

/** Server standalone class row → client Course with one synthetic lesson. */
export function serverClassToCourse(row: ServerClassItem): Course {
  const video = row.videoUrl || VID.landscapeB;
  return {
    id: row.id,
    title: row.title,
    teacherId: row.teacher.id,
    style: styleLabel(row.style),
    level: levelOf(row.difficulty),
    cover: coverFor(row),
    lessons: [
      {
        id: `${row.id}::main`,
        title: row.title,
        dur: Math.max(1, Math.round(row.durationSec / 60)),
        video,
        moves: movesOf(row.steps),
        desc: row.description,
      },
    ],
    enrolled: 0,
    rating: 0,
    about: row.description || row.title,
    isNew: true,
    trailer: video,
  };
}

export function serverItemToCourse(row: ServerCatalogItem): Course {
  return row.kind === "course" ? serverCourseToCourse(row) : serverClassToCourse(row);
}

/**
 * Day 23 — free platform. Rows no longer publish a price; the hook shape
 * keeps the catalog contract stable while every lesson is free to play.
 */
export function pricingFromRow(_row: { priceCents: number; creditPrice: number }): ClassPricing {
  return {
    accessModel: "free" as const,
    priceCents: 0,
    creditPrice: 0,
  };
}

/** Deterministic teacher avatar (privacy-safe: public projection only). */
export const teacherAvatarFor = (teacherId: string) => AVATARS.me.replace("u=densen-me", `u=densen-teacher-${teacherId}`);

/**
 * Merge the seed catalog with published server items, newest server items
 * first after the seeds (seeds guarantee the free track is always at hand).
 */
export function mergeCatalog(seed: Course[], serverRows: ServerCatalogItem[] | undefined): Course[] {
  if (!serverRows || serverRows.length === 0) return seed;
  const seedIds = new Set(seed.map((c) => c.id));
  const extras = serverRows
    .filter((r) => !seedIds.has(r.id))
    .map(serverItemToCourse);
  return [...seed, ...extras];
}
