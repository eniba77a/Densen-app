/**
 * DENSEN — useCatalogCourse hook (Day 8 bridge).
 * ==============================================
 * Class pages are addressed by ids from two id spaces:
 *   - seed catalog strings ("c_begin1") — resolved synchronously;
 *   - Convex catalog rows (published Studio classes/courses).
 * The hook resolves seeds instantly and subscribes to the public catalog
 * query for anything else; guests see published rows too (browsing is
 * public — content access is still priced on the class page).
 *
 * Teacher identity comes from the server's PUBLIC projection only
 * (displayName + handle); server rows synthesize a client `User` view with
 * no PII and no invented follower counts. Seed rows still resolve their
 * teacher through the existing `userById` helper at the call site, so the
 * hook returns `teacher: undefined` for them.
 */
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { courseById, type Course, type User } from "./store";
import { pricingFromRow, serverItemToCourse } from "./serverCatalog";
import { type ClassPricing } from "./learning";
import { IMG } from "./media";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CatalogCourse {
  course: Course;
  /** Public teacher view for server rows; undefined for seed rows. */
  teacher?: User;
  /** Pricing derived from the row (server rows) — undefined for seeds. */
  pricing?: ClassPricing;
  /** True when resolved from a live published Studio row. */
  fromServer: boolean;
}

/** Public teacher view for a catalog row (privacy-safe projection). */
function teacherViewFor(row: any): User {
  return {
    id: row.teacher.id,
    name: row.teacher.displayName,
    username: row.teacher.handle,
    avatar: IMG.catStudio, // neutral stage image until profile photos exist
    bio: "",
    styles: [row.style],
    followers: 0,
    following: 0,
    likes: 0,
    verified: Boolean(row.teacher.verified),
    teacher: true,
  };
}

/**
 * Resolve a class-page id → Course. Seeds win (they carry lesson media);
 * anything else resolves from the published catalog subscription.
 */
export function useCatalogCourse(courseId: string | undefined): CatalogCourse | undefined {
  const seed = courseId ? courseById(courseId) : undefined;
  const needServer = Boolean(courseId) && !seed;

  const rows = useQuery(
    api.catalog.listPublishedAll,
    needServer ? {} : "skip"
  ) as any[] | undefined;

  return useMemo(() => {
    if (seed) return { course: seed, teacher: undefined, pricing: undefined, fromServer: false };
    if (!rows) return undefined;
    const row = rows.find((r) => r.id === courseId);
    if (!row) return undefined;
    return {
      course: serverItemToCourse(row),
      teacher: teacherViewFor(row),
      pricing: pricingFromRow(row),
      fromServer: true,
    };
  }, [seed, rows, courseId]);
}
