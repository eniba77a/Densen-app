/* eslint-disable @typescript-eslint/no-explicit-any */
import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  buildDiscoverSections,
  sanitizeResults,
  searchEntities,
  suggestFromRows,
  type CallerBand,
  type EntityKind,
  type SearchCaller,
  type SearchEntity,
} from "./discover";
import { callerFromToken } from "./content";

/**
 * Day 17 — DENSEN DISCOVER wire layer.
 *
 * Reads REAL tables (no seed duplication):
 *   dancers/teachers ← profiles + users + teacherProfiles + privacySettings
 *   moves/combos/choreographies/classes/courses ← studio rows (published only)
 *   challenges ← challenges (published/platform rows)
 *   styles ← derived from profiles.styles + catalog styles (real usage counts)
 *   hashtags ← derived from public posts only
 *
 * All decisions (visibility, age safety, ranking, sanitization) live in the
 * pure core `discover.ts`; this file only maps rows and resolves the caller.
 */

interface DiscoverCaller {
  searchCaller: SearchCaller;
  userId: string;
  blocked: Set<string>;
  muted: Set<string>;
}

/** Session token → discover caller (null = guest). Invalid token ⇒ guest. */
async function resolveCaller(db: any, sessionToken: string | undefined): Promise<DiscoverCaller | null> {
  if (!sessionToken) return null;
  const caller = await callerFromToken(db, sessionToken);
  if (!caller) return null;

  const me = (await db.get(caller.userId as never)) as any;
  const followingIds = (
    (await db
      .query("follows")
      .withIndex("by_follower", (q: any) => q.eq("followerId", caller.userId))
      .collect()) as { followingId: string }[]
  ).map((f) => String(f.followingId));

  const blockRows = (await db
    .query("blocks")
    .withIndex("by_blocker", (q: any) => q.eq("blockerId", caller.userId))
    .collect()) as any[];
  const muteRows = (await db
    .query("mutes")
    .withIndex("by_muter", (q: any) => q.eq("muterId", caller.userId))
    .collect()) as any[];

  // Broad-location consent comes from the caller's privacySettings (showCity);
  // the token itself is the caller's own profile city (approximate by design).
  const privacy = (await db
    .query("privacySettings")
    .withIndex("by_user", (q: any) => q.eq("userId", caller.userId))
    .unique()) as { showCity?: boolean } | null;
  const myProfile = (await db
    .query("profiles")
    .withIndex("userId", (q: any) => q.eq("userId", caller.userId))
    .unique()) as { city?: string } | null;

  const band: CallerBand = !me.isMinor
    ? "adult"
    : me.ageBand === "child_u13" || me.ageBand === "teen13_15" || me.ageBand === "teen16_17"
      ? me.ageBand
      : "teen16_17";

  return {
    searchCaller: {
      band,
      userId: String(caller.userId),
      followingIds,
      locationEnabled: privacy?.showCity === true,
      location:
        privacy?.showCity === true && myProfile?.city
          ? String(myProfile.city).trim().toLowerCase()
          : undefined,
    },
    userId: String(caller.userId),
    blocked: new Set(blockRows.map((r) => String(r.blockedId))),
    muted: new Set(muteRows.map((r) => String(r.mutedId))),
  };
}

// ---------------------------------------------------------------------------
// Entity mappers (real rows → SearchEntity)
// ---------------------------------------------------------------------------

const STUDIO_KINDS: Record<string, EntityKind> = {
  moves: "move",
  combos: "combo",
  choreographies: "choreography",
  classes: "class",
  courses: "course",
  challenges: "challenge",
};

async function collectStudioEntities(db: any, caller: DiscoverCaller | null): Promise<SearchEntity[]> {
  const rows: SearchEntity[] = [];
  const uid = caller?.userId;
  for (const table of Object.keys(STUDIO_KINDS)) {
    const kind = STUDIO_KINDS[table];
    const all = (await db.query(table).collect()) as any[];
    for (const r of all) {
      // Studio rows must be published to be discoverable.
      const pub = r.studioStatus ?? r.status;
      const isPublished = pub === "published" || (r.status === "published" && r.studioStatus === undefined);
      if (!isPublished) continue;

      const ownerId = String(r.teacherId ?? r.authorId ?? "");
      const visibility = r.visibility ?? "public";
      const followed = !!caller && caller.searchCaller.followingIds.includes(ownerId);
      const own = !!uid && ownerId === uid;

      rows.push({
        id: String(r._id),
        kind,
        label: String(r.title ?? r.name ?? ""),
        keywords: [r.style, r.description, ...(r.tags ?? [])].filter(
          (x: unknown): x is string => typeof x === "string" && x.length > 0,
        ),
        popularity: (r.participantCount ?? 0) + (r.usesCount ?? 0),
        createdAt: r.createdAt ?? 0,
        visibility,
        ownerId,
        ownerIsFollowed: followed,
        own,
        verified: undefined,
        level: r.difficulty,
        priceCents: r.priceCents,
        enrolled: r.participantCount,
        maturity: "all",
      });
    }
  }
  return rows;
}

/**
 * Style rows — derived from real usage: every dancer profile lists styles;
 * every published catalog row carries a style. Count + collect both.
 */
async function collectStyleEntities(db: any): Promise<SearchEntity[]> {
  const counts = new Map<string, number>();
  const bump = (raw: unknown, by = 1) => {
    if (typeof raw !== "string") return;
    const s = raw.trim();
    if (s.length < 2 || s.length > 40) return;
    const key = s.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + by);
  };
  const labelFor = new Map<string, string>();

  const profiles = (await db.query("profiles").collect()) as any[];
  for (const p of profiles) {
    for (const st of p.styles ?? []) {
      bump(st, 2); // a dancer's chosen style weighs more than a tag mention
      if (!labelFor.has(String(st).toLowerCase())) labelFor.set(String(st).toLowerCase(), String(st));
    }
  }
  for (const table of ["classes", "courses", "moves", "combos"] as const) {
    for (const r of (await db.query(table).collect()) as any[]) {
      if (r.style) {
        bump(r.style);
        if (!labelFor.has(String(r.style).toLowerCase())) labelFor.set(String(r.style).toLowerCase(), String(r.style));
      }
    }
  }

  return [...counts.entries()].map(([key, n]) => ({
    id: `style:${key}`,
    kind: "style" as const,
    label: labelFor.get(key) ?? key,
    keywords: [],
    popularity: n,
    createdAt: 0,
    visibility: "public" as const,
    ownerId: "",
  }));
}

/** Hashtag rows — aggregated from PUBLIC posts only (never private/followers). */
async function collectHashtagEntities(db: any): Promise<SearchEntity[]> {
  const counts = new Map<string, { uses: number; first: number }>();
  for (const p of (await db.query("posts").collect()) as any[]) {
    if (p.visibility !== "public") continue;
    for (const tag of p.hashtags ?? []) {
      const t = String(tag).replace(/^#+/, "").trim().toLowerCase();
      if (!t || t.length > 40) continue;
      const cur = counts.get(t) ?? { uses: 0, first: p.createdAt ?? 0 };
      cur.uses += 1;
      counts.set(t, cur);
    }
  }
  return [...counts.entries()].map(([tag, c]) => ({
    id: `tag:${tag}`,
    kind: "hashtag" as const,
    label: tag,
    keywords: [],
    popularity: c.uses,
    createdAt: c.first,
    visibility: "public" as const,
    ownerId: "",
  }));
}

/**
 * Dancer/teacher rows from profiles+users. Applies:
 *   - private-profile handling (visibility via decideProfileVisibility in core)
 *   - blocked/muted relationships (never visible to the blocked/muting side)
 *   - only ACTIVE users (suspended/restricted/deleted never surface)
 *   - status:"restricted" users are hidden from discovery entirely
 */
async function collectPeopleEntities(db: any, caller: DiscoverCaller | null): Promise<{
  rows: SearchEntity[];
  profileMeta: Map<string, { discoverableByHandle: boolean; visibility: "public" | "followers" | "private" }>;
}> {
  const rows: SearchEntity[] = [];
  const profileMeta = new Map<string, { discoverableByHandle: boolean; visibility: "public" | "followers" | "private" }>();
  const uid = caller?.userId;

  const profiles = (await db.query("profiles").collect()) as any[];
  const userRows = (await db.query("users").collect()) as any[];
  const usersById = new Map(userRows.map((u) => [String(u._id), u]));

  // Verified-teacher set (teacherProfiles.status === "verified").
  const verifiedTeacherIds = new Set(
    ((await db.query("teacherProfiles").collect()) as any[])
      .filter((t) => t.status === "verified")
      .map((t) => String(t.userId)),
  );

  // Privacy settings per profile owner.
  const privacyRows = (await db.query("privacySettings").collect()) as any[];
  const privacyByUser = new Map(privacyRows.map((p) => [String(p.userId), p]));

  for (const p of profiles) {
    const ownerId = String(p.userId);
    const u = usersById.get(ownerId);
    if (!u) continue;
    if (u._id === uid) continue; // never surface the caller's own profile
    if (u.status !== "active") continue;
    if (caller) {
      if (caller.blocked.has(ownerId) || caller.muted.has(ownerId)) continue;
    }

    const privacy = privacyByUser.get(ownerId);
    const visibility = p.isPrivate === true ? "private" : "public";
    const discoverable = privacy?.discoverableByHandle !== false; // default true

    const isTeacher = verifiedTeacherIds.has(ownerId) || u.role === "teacher";
    const locOn = privacy?.showCity === true;

    const ent: SearchEntity = {
      id: ownerId,
      kind: isTeacher ? "teacher" : "dancer",
      label: String(p.displayName ?? p.handle ?? ""),
      keywords: [String(p.handle ?? ""), p.bio, p.city, ...(p.styles ?? [])].filter(
        (x: unknown): x is string => typeof x === "string" && x.length > 0,
      ),
      popularity: p.followerCount ?? 0,
      createdAt: p.createdAt ?? 0,
      visibility,
      ownerId,
      ownerIsFollowed: !!caller && caller.searchCaller.followingIds.includes(ownerId),
      own: false,
      verified: isTeacher || undefined,
      // Broad city forwarded ONLY when the owner consented (showCity).
      city: locOn ? (p.city ? String(p.city).toLowerCase() : undefined) : undefined,
      maturity: "all",
    };
    profileMeta.set(ownerId, { discoverableByHandle: discoverable, visibility });
    rows.push(ent);
  }
  return { rows, profileMeta };
}

/**
 * Profile privacy flags keyed by userId (the people-entity id), consumed by
 * the core's decideProfileVisibility via collectEntities/searchEntities.
 */
async function collectAllEntities(db: any, caller: DiscoverCaller | null) {
  const studio = await collectStudioEntities(db, caller);
  const people = await collectPeopleEntities(db, caller);
  const styles = await collectStyleEntities(db);
  const hashtags = await collectHashtagEntities(db);
  return {
    rows: [...studio, ...people.rows, ...styles, ...hashtags],
    profileMeta: people.profileMeta,
  };
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

const KIND_VALUES = [
  "dancer", "teacher", "move", "combo", "choreography", "class", "course", "challenge", "style", "hashtag",
] as const;

function parseKinds(raw: string[] | undefined): EntityKind[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const allowed = raw.filter((k): k is (typeof KIND_VALUES)[number] => (KIND_VALUES as readonly string[]).includes(k));
  return allowed.length > 0 ? (allowed as EntityKind[]) : undefined;
}

/** Search across all entity kinds. Guest-safe (public catalog only). */
export const searchAll = queryGeneric({
  args: {
    sessionToken: v.optional(v.string()),
    q: v.string(),
    kinds: v.optional(v.array(v.string())),
    location: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = args.q.trim();
    if (q.length < 2) return { ok: true as const, results: [], total: 0 };

    const caller = await resolveCaller(ctx.db, args.sessionToken);
    const { rows, profileMeta } = await collectAllEntities(ctx.db, caller);
    const out = searchEntities({
      caller: caller?.searchCaller ?? null,
      rows,
      query: q,
      kinds: parseKinds(args.kinds),
      location: args.location,
      limit: Math.min(args.limit ?? 40, 60),
      profileMeta,
    });
    if (!out.ok) return { ok: true as const, results: [], total: 0 };

    return {
      ok: true as const,
      total: out.rows.length,
      results: sanitizeResults(out.rows, { caller: caller?.searchCaller ?? null }),
    };
  },
});

/** Typeahead suggestions across all visible kinds. Guest-safe. */
export const searchSuggestions = queryGeneric({
  args: { sessionToken: v.optional(v.string()), q: v.string() },
  handler: async (ctx, args) => {
    const q = args.q.trim();
    if (q.length < 2) return { ok: true as const, suggestions: [] };
    const caller = await resolveCaller(ctx.db, args.sessionToken);
    const { rows, profileMeta } = await collectAllEntities(ctx.db, caller);
    const suggestions = suggestFromRows(rows, q, 8, caller?.searchCaller ?? null, profileMeta);
    return { ok: true as const, suggestions };
  },
});

/** The discover feed: themed rails over real data. Guest-safe. */
export const discoverFeed = queryGeneric({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const caller = await resolveCaller(ctx.db, args.sessionToken);
    const { rows, profileMeta } = await collectAllEntities(ctx.db, caller);
    const sections = buildDiscoverSections({
      caller: caller?.searchCaller ?? null,
      rows,
      now: Date.now(),
      profileMeta,
    });
    return {
      ok: true as const,
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        results: sanitizeResults(s.rows, { caller: caller?.searchCaller ?? null }),
      })),
    };
  },
});
