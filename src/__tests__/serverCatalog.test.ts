/**
 * Day 8 — server catalog adapter tests.
 * Pins the bridge between published Studio rows and the client Learn views:
 * id-space isolation, level/style mapping, pricing derivation from the row
 * itself, and merge determinism (seeds first, no duplicates).
 */
import { describe, expect, it } from "vitest";
import {
  mergeCatalog,
  pricingFromRow,
  serverClassToCourse,
  serverCourseToCourse,
  type ServerCatalogItem,
  type ServerClassItem,
  type ServerCourseItem,
} from "../../src/data/serverCatalog";
import { courses } from "../../src/data/store";

const teacher = { id: "u_server_teacher", handle: "nova.moves", displayName: "Nova Kelmendi", verified: true };

const courseRow: ServerCourseItem = {
  id: "kx7a1b2c3d4e5f6g7",
  kind: "course",
  title: "Foundations of Flow",
  description: "A four-part course on moving with intent.",
  style: "Hip-Hop",
  difficulty: "beginner",
  coverUrl: "",
  priceCents: 800,
  creditPrice: 80,
  createdAt: 1_700_000_000_000,
  teacher,
  lessons: [
    { id: "kles1", position: 1, title: "Finding the groove", durationSec: 600, xpReward: 150 },
    { id: "kles2", position: 2, title: "Footwork alphabet", durationSec: 540, xpReward: 150 },
  ],
};

const classRow: ServerClassItem = {
  id: "kx9z8y7x6w5v4u3t2",
  kind: "class",
  title: "One-Shot Commercial Combo",
  description: "Eight counts, full energy.",
  style: "Commercial",
  difficulty: "intermediate",
  coverUrl: "https://cdn.example.com/cover.jpg",
  durationSec: 900,
  priceCents: 0,
  creditPrice: 60,
  createdAt: 1_700_000_100_000,
  teacher,
};

const rows: ServerCatalogItem[] = [courseRow, classRow];

describe("serverCourseToCourse", () => {
  it("maps a published course into the client Course shape", () => {
    const c = serverCourseToCourse(courseRow);
    expect(c.id).toBe(courseRow.id);
    expect(c.title).toBe("Foundations of Flow");
    expect(c.style).toBe("Hip Hop"); // studio "Hip-Hop" ↔ catalog "Hip Hop"
    expect(c.level).toBe("Beginner");
    expect(c.cover).toContain("http"); // deterministic fallback cover
    expect(c.lessons).toHaveLength(2);
    expect(c.lessons[0].dur).toBe(10); // 600s → 10 min, min 1
    expect(c.rating).toBe(0); // honest zeros — no invented social proof
  });

  it("maps difficulty to the client level vocabulary", () => {
    expect(serverCourseToCourse({ ...courseRow, difficulty: "intermediate" }).level).toBe("Intermediate");
    expect(serverCourseToCourse({ ...courseRow, difficulty: "advanced" }).level).toBe("Advanced");
  });

  it("rounds lesson durations up to at least one minute", () => {
    const c = serverCourseToCourse({ ...courseRow, lessons: [{ id: "kles0", position: 1, title: "Short", durationSec: 25, xpReward: 10 }] });
    expect(c.lessons[0].dur).toBe(1);
  });
});

describe("serverClassToCourse", () => {
  it("turns a standalone class into a one-lesson course", () => {
    const c = serverClassToCourse(classRow);
    expect(c.lessons).toHaveLength(1);
    expect(c.lessons[0].id).toBe(`${classRow.id}::main`);
    expect(c.lessons[0].dur).toBe(15);
    expect(c.level).toBe("Intermediate");
    expect(c.cover).toBe("https://cdn.example.com/cover.jpg"); // real cover wins
  });
});

describe("pricingFromRow (Day 23: free platform)", () => {
  it("resolves EVERY row to free — legacy price fields no longer gate anything", () => {
    expect(pricingFromRow({ priceCents: 0, creditPrice: 0 })).toEqual({ accessModel: "free", priceCents: 0, creditPrice: 0 });
    expect(pricingFromRow({ priceCents: 800, creditPrice: 0 }).accessModel).toBe("free");
    expect(pricingFromRow({ priceCents: 0, creditPrice: 60 }).accessModel).toBe("free");
    expect(pricingFromRow({ priceCents: 800, creditPrice: 80 }).accessModel).toBe("free");
    expect(pricingFromRow({ priceCents: 800, creditPrice: 80 }).priceCents).toBe(0);
    expect(pricingFromRow({ priceCents: 800, creditPrice: 80 }).creditPrice).toBe(0);
  });

  it("keeps historical rows free in the catalog projection", () => {
    expect(pricingFromRow(classRow)).toEqual({ accessModel: "free", priceCents: 0, creditPrice: 0 });
  });
});

describe("mergeCatalog", () => {
  it("appends server rows after the seed catalog without duplicates", () => {
    const merged = mergeCatalog(courses, rows);
    expect(merged.length).toBe(courses.length + 2);
    expect(merged.slice(0, courses.length)).toEqual(courses);
    expect(merged.map((c) => c.id)).toContain(courseRow.id);
    expect(merged.map((c) => c.id)).toContain(classRow.id);
  });

  it("is a no-op without server rows and dedupes colliding ids", () => {
    expect(mergeCatalog(courses, undefined)).toBe(courses);
    expect(mergeCatalog(courses, [])).toBe(courses);
    const seedClone = { ...courseRow, id: courses[0].id };
    expect(mergeCatalog(courses, [seedClone])).toStrictEqual(courses);
  });
});
