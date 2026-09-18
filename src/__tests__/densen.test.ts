import { describe, expect, it } from "vitest";
import { dictionaries, type Lang, type TKey } from "../i18n";
import {
  achievements,
  audioById,
  audios,
  challenges,
  conversations,
  courseById,
  courseCategories,
  courses,
  fmt,
  hashtags,
  initialCompletedLessons,
  initialRecentlyWatched,
  leaderboardCategory,
  liveClasses,
  ME,
  notifications,
  posts,
  teamById,
  teams,
  userById,
  users,
} from "../data/store";
import { AVATARS, IMG, VID } from "../data/media";

/* --------------------------------- i18n --------------------------------- */

const langs: Lang[] = ["en", "sq"];

describe("i18n dictionaries", () => {
  it("sq covers exactly the same keys as en (source of truth)", () => {
    const enKeys = Object.keys(dictionaries.en).sort();
    const sqKeys = Object.keys(dictionaries.sq).sort();
    expect(sqKeys).toEqual(enKeys);
  });

  it("no dictionary has empty or whitespace-only values", () => {
    for (const lang of langs) {
      for (const [key, value] of Object.entries(dictionaries[lang])) {
        expect(value.trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("en and sq use the same {interpolation} variables per key", () => {
    const varsOf = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(dictionaries.en) as TKey[]) {
      expect(varsOf(dictionaries.sq[key]), `variable mismatch at ${key}`).toEqual(varsOf(dictionaries.en[key]));
    }
  });

  it("interpolation replaces every placeholder", () => {
    const template = dictionaries.en["progress.xpToNext"];
    const out = template.replace("{level}", "3");
    expect(out).not.toContain("{level}");
    expect(out).toContain("3");
  });
});

/* ----------------------------- data integrity ---------------------------- */

const userIds = new Set([...users.map((u) => u.id), ME.id]);

describe("mock data integrity", () => {
  it("ids are unique within each collection", () => {
    const check = (label: string, ids: string[]) =>
      expect(new Set(ids).size, `duplicate ids in ${label}`).toBe(ids.length);
    check("users", users.map((u) => u.id));
    check("courses", courses.map((c) => c.id));
    check("posts", posts.map((p) => p.id));
    check("challenges", challenges.map((c) => c.id));
    check("audios", audios.map((a) => a.id));
    check("teams", teams.map((t) => t.id));
    check("achievements", achievements.map((a) => a.id));
  });

  it("lesson ids are globally unique (progress is keyed by lessonId)", () => {
    const ids = courses.flatMap((c) => c.lessons.map((l) => l.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every course has a valid teacher, non-empty curriculum and media", () => {
    for (const c of courses) {
      expect(userIds.has(c.teacherId), `course ${c.id} teacher ${c.teacherId} missing`).toBe(true);
      expect(c.lessons.length, `course ${c.id} has no lessons`).toBeGreaterThan(0);
      expect(c.cover.startsWith("https://")).toBe(true);
      expect(c.trailer.startsWith("https://")).toBe(true);
      for (const l of c.lessons) {
        expect(l.video.startsWith("https://")).toBe(true);
        expect(l.dur).toBeGreaterThan(0);
        expect(l.moves.length).toBeGreaterThan(0);
      }
    }
  });

  it("every teacherId points at an actual teacher profile", () => {
    const teacherIds = new Set(users.filter((u) => u.teacher).map((u) => u.id));
    for (const c of [...courses, ...liveClasses]) {
      expect(teacherIds.has(c.teacherId), `${c.id} teacher ${c.teacherId} is not flagged teacher`).toBe(true);
    }
  });

  it("every post references an existing audio, user and (for duets) post", () => {
    const postIds = new Set(posts.map((p) => p.id));
    for (const p of posts) {
      expect(userIds.has(p.userId), `post ${p.id} user ${p.userId} missing`).toBe(true);
      expect(audios.some((a) => a.id === p.audioId), `post ${p.id} audio ${p.audioId} missing`).toBe(true);
      expect(p.hashtags.length).toBeGreaterThan(0);
      if (p.duetOf) expect(postIds.has(p.duetOf), `post ${p.id} duetOf ${p.duetOf} missing`).toBe(true);
      if (p.lessonRef) expect(courses.some((c) => c.id === p.lessonRef), `post ${p.id} lessonRef broken`).toBe(true);
    }
  });

  it("comments and conversation participants resolve to real users", () => {
    for (const p of posts) {
      for (const c of p.comments) expect(userIds.has(c.userId), `comment ${c.id} user missing`).toBe(true);
    }
    for (const conv of conversations) {
      for (const participant of conv.participants) {
        expect(userIds.has(participant), `conversation ${conv.id} participant ${participant} missing`).toBe(true);
      }
    }
  });

  it("challenges link to real courses and real entrants", () => {
    for (const ch of challenges) {
      expect(courses.some((c) => c.id === ch.tutorialCourseId), `challenge ${ch.id} tutorial course missing`).toBe(true);
      expect(userIds.has(ch.featuredChoreoBy), `challenge ${ch.id} featuredChoreoBy missing`).toBe(true);
      for (const entry of ch.entries) {
        expect(userIds.has(entry.userId), `challenge ${ch.id} entry user missing`).toBe(true);
        expect(posts.some((p) => p.id === entry.postId), `challenge ${ch.id} entry post missing`).toBe(true);
      }
    }
  });

  it("teams and notifications reference real users", () => {
    for (const team of teams) {
      for (const m of team.members) expect(userIds.has(m), `team ${team.id} member ${m} missing`).toBe(true);
      expect(userIds.has(team.foundedBy), `team ${team.id} founder missing`).toBe(true);
    }
    for (const n of notifications) {
      if (n.actorId) expect(userIds.has(n.actorId), `notification ${n.id} actor missing`).toBe(true);
    }
  });

  it("seeded progress references real lessons and courses", () => {
    const allLessons = new Set(courses.flatMap((c) => c.lessons.map((l) => l.id)));
    for (const id of initialCompletedLessons) {
      expect(allLessons.has(id), `initialCompletedLessons has unknown lesson ${id}`).toBe(true);
    }
    for (const r of initialRecentlyWatched) {
      expect(courses.some((c) => c.id === r.courseId), `recently watched course ${r.courseId} missing`).toBe(true);
      expect(allLessons.has(r.lessonId), `recently watched lesson ${r.lessonId} missing`).toBe(true);
      const course = courses.find((c) => c.id === r.courseId)!;
      expect(course.lessons.some((l) => l.id === r.lessonId), `lesson ${r.lessonId} not in course ${r.courseId}`).toBe(true);
    }
  });

  it("locked achievements show progress, unlocked ones do not exceed 100", () => {
    for (const a of achievements) {
      if (!a.unlocked) {
        expect(typeof a.progress).toBe("number");
        expect(a.progress ?? 0).toBeGreaterThanOrEqual(0);
        expect(a.progress ?? 0).toBeLessThan(100);
      }
    }
  });

  it("hashtags are unique with positive post counts", () => {
    const tags = hashtags.map((h) => h.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const h of hashtags) expect(h.posts).toBeGreaterThan(0);
  });

  it("course categories cover the styles used by courses", () => {
    const styleSet = new Set(courseCategories.map((c) => c.id));
    for (const c of courses) {
      expect(styleSet.has(c.style), `course ${c.id} style "${c.style}" has no category`).toBe(true);
    }
  });
});

/* -------------------------------- helpers -------------------------------- */

describe("data helpers", () => {
  it("userById resolves 'me' and real ids, falling back safely", () => {
    expect(userById("me").id).toBe("me");
    expect(userById("u_sara").id).toBe("u_sara");
    expect(userById("nonexistent").id).toBe(users[0].id);
  });

  it("courseById / teamById / audioById resolve seeded ids", () => {
    expect(courseById("c_hiphop1")?.title).toBe("Hip Hop Foundations");
    expect(teamById("t_urban")?.name).toBe("Urban Pulse");
    expect(teamById(undefined)).toBeUndefined();
    expect(audioById("a2")?.name).toBe("Golden Hour");
    expect(audioById("missing")?.id).toBe(audios[0].id);
  });

  it("leaderboardCategory returns ranked rows with descending xp for every category/period", () => {
    const cats = ["dancers", "creators", "improved", "challenge", "consistent", "teachers"] as const;
    const periods = ["Weekly", "Monthly", "All Time"];
    const teacherCount = users.filter((u) => u.teacher).length;
    for (const cat of cats) {
      for (const period of periods) {
        const rows = leaderboardCategory(cat, period);
        // "Top Teachers" lists exactly the platform's teachers; other boards rank 10 dancers.
        expect(rows.length, `${cat}/${period} row count`).toBe(cat === "teachers" ? teacherCount : 10);
        for (const row of rows) expect(userIds.has(row.userId), `${cat}/${period} row user missing`).toBe(true);
        for (let i = 1; i < rows.length; i++) {
          expect(rows[i - 1].xp, `${cat}/${period} xp not descending at ${i}`).toBeGreaterThanOrEqual(rows[i].xp);
        }
      }
    }
    // period multipliers must grow
    const weekly = leaderboardCategory("dancers", "Weekly")[0].xp;
    const monthly = leaderboardCategory("dancers", "Monthly")[0].xp;
    const allTime = leaderboardCategory("dancers", "All Time")[0].xp;
    expect(monthly).toBeGreaterThan(weekly);
    expect(allTime).toBeGreaterThan(monthly);
  });
});

/* ------------------------------- formatting ------------------------------ */

describe("fmt number formatting", () => {
  it("formats small, thousand and million values", () => {
    expect(fmt(950)).toBe("950");
    expect(fmt(1000)).toBe("1.0K");
    expect(fmt(48200)).toBe("48.2K");
    expect(fmt(2_400_000)).toBe("2.4M");
  });
});

/* --------------------------------- media --------------------------------- */

describe("media registry", () => {
  it("all registry entries are https URLs", () => {
    for (const [key, url] of Object.entries(IMG)) {
      expect(url.startsWith("https://images.unsplash.com/"), `IMG.${key} broken`).toBe(true);
    }
    for (const [key, url] of Object.entries(AVATARS)) {
      expect(url.startsWith("https://"), `AVATARS.${key} broken`).toBe(true);
    }
    for (const [key, url] of Object.entries(VID)) {
      expect(url.startsWith("https://videos.pexels.com/"), `VID.${key} broken`).toBe(true);
      expect(url.endsWith(".mp4"), `VID.${key} not mp4`).toBe(true);
    }
  });
});
