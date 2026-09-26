/**
 * Day 17 — DENSEN DISCOVER (pure decision core).
 *
 * NO Convex imports — every function here is a pure function of its inputs, so
 * unit tests cover the full search/discover behavior without a backend.
 *
 * Phases per request:
 *   1. decideSearchScope      — WHO is searching: bands, dancer discovery, location perms.
 *   2. decideProfileVisibility — which dancer/teacher rows this caller may see
 *                               (private profiles, followers-only, handle discovery).
 *   3. collectEntities        — which rows are visible at all (drafts, moderation, age).
 *   4. rank + suggest + sections — relevance-first ordering, typeahead, discover rails.
 *   5. sanitizeResults        — the LAST gate before any row leaves the core:
 *                               minors never get location, city only when its owner
 *                               consented via showCity, drafts never leave the studio.
 *
 * FIELD CONTRACT (wire → core):
 *   - `location` on a row is the OWNER-CONSENTED broad city token (profiles.showCity
 *     was true). The core never receives precise coordinates — the schema stores
 *     only approximate city, and the wire only forwards it when showCity is set.
 *   - Minors never see dancer discovery (`canSearchDancers=false`) and never get
 *     location output (`canUseLocation=false`), regardless of any row's consent.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CallerBand = "child_u13" | "teen13_15" | "teen16_17" | "adult";

export type EntityKind =
  | "dancer"
  | "teacher"
  | "move"
  | "combo"
  | "choreography"
  | "class"
  | "course"
  | "challenge"
  | "style"
  | "hashtag";

export type Visibility = "public" | "followers" | "private";

export interface SearchEntity {
  id: string;
  kind: EntityKind;
  /** Primary display label (name/title). */
  label: string;
  /** Extra searchable text (styles, tags, city, description). */
  keywords: string[];
  /** Real demand signal (followers, practice counts, purchases). */
  popularity: number;
  /** Recency for "new" ranking (Date.now()-compatible). */
  createdAt: number;
  visibility: Visibility;
  /** Owner (author/creator). For dancers/teachers this is the profile owner. */
  ownerId: string;
  /** True when this caller follows the owner (collect-phase input). */
  ownerIsFollowed?: boolean;
  /** True when this caller is the owner. */
  own?: boolean;
  /** Admin-verified teacher. */
  verified?: boolean;
  /** Owner-consented broad city token (profiles.showCity). Never precise. */
  city?: string;
  /** Difficulty label (studio kinds). */
  level?: "beginner" | "intermediate" | "advanced";
  /** Price in euro cents (classes/courses). 0 = free. */
  priceCents?: number;
  /** Number of students/users actively using this row. */
  enrolled?: number;
  /** Moderation-hidden rows: visible to their owner only. */
  flagged?: boolean;
  /** Content maturity (minors get all-ages results only). */
  maturity?: "all" | "mature";
}

export interface SearchCaller {
  band: CallerBand;
  /** Session-user id (present for signed-in callers). */
  userId?: string;
  /** Owner ids this caller follows (followers-visibility + tie-breaks). */
  followingIds: string[];
  /** Broad-location consent (privacySettings.showCity of the CALLER). */
  locationEnabled: boolean;
  /** Broad location token of the caller (consented lookups only). */
  location?: string;
}

// ---------------------------------------------------------------------------
// Phase 1 — scope: who may search what
// ---------------------------------------------------------------------------

export interface SearchScope {
  /** Caller may discover other dancers (dancer/teacher kinds). */
  canSearchDancers: boolean;
  /** Caller may use the location filter / receive location output. */
  canUseLocation: boolean;
  /** Restrict results to all-ages content. */
  allAgesOnly: boolean;
  band: CallerBand;
  guest: boolean;
}

export function decideSearchScope(caller: SearchCaller | null): SearchScope {
  const band = caller?.band ?? "adult";
  const isMinor = band === "child_u13" || band === "teen13_15" || band === "teen16_17";
  const guest = !caller;
  return {
    canSearchDancers: !!caller && !isMinor,
    canUseLocation: !!caller && !isMinor && caller.locationEnabled === true,
    // Guests have UNKNOWN age → all-ages catalog only (fail-safe default).
    allAgesOnly: isMinor || guest,
    band,
    guest,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 — profile visibility (private-profile respect)
// ---------------------------------------------------------------------------

export interface ProfileVisibilityInput {
  visibility: Visibility;
  /** privacySettings.discoverableByHandle on the profile's owner. */
  discoverableByHandle: boolean;
  isOwner: boolean;
  /** Caller follows this profile's owner. */
  isFollowed: boolean;
  /** Caller is searching (not browsing a rail) — handle discovery applies here. */
  isSearch: boolean;
}

/**
 * Private-profile rule:
 *  - private  → owner always; others only via discoverableByHandle SEARCH
 *               (the row surfaces as a bare handle hit, never in rails).
 *  - followers→ owner + dancers who follow the owner (search AND rails).
 *  - public   → everyone.
 */
export function decideProfileVisibility(input: ProfileVisibilityInput): boolean {
  if (input.isOwner) return true;
  if (input.visibility === "public") return true;
  if (input.visibility === "followers") return input.isFollowed;
  // private
  return input.isSearch && input.discoverableByHandle;
}

// ---------------------------------------------------------------------------
// Phase 3 — collect: visible rows per kind
// ---------------------------------------------------------------------------

export interface CollectOptions {
  kind: EntityKind;
  caller: SearchCaller | null;
  rows: SearchEntity[];
  /** Max rows returned (safety cap). */
  limit?: number;
  /** Search mode: handle-discovery applies to private profiles. */
  isSearch?: boolean;
  /** Per-row privacy supplement for dancer/teacher rows (wire-provided). */
  profileMeta?: Map<string, { discoverableByHandle: boolean; visibility: Visibility }>;
}

export function collectEntities({ kind, caller, rows, limit = 60, isSearch = true, profileMeta }: CollectOptions): SearchEntity[] {
  const scope = decideSearchScope(caller);
  if ((kind === "dancer" || kind === "teacher") && !scope.canSearchDancers) return [];
  const out: SearchEntity[] = [];
  for (const row of rows) {
    if (row.kind !== kind) continue;
    // Moderation-hidden rows are visible to their owner only.
    if (row.flagged && !row.own) continue;
    // Minors browse an all-ages catalog only.
    if (scope.allAgesOnly && row.maturity === "mature") continue;

    if (kind === "dancer" || kind === "teacher") {
      const meta = profileMeta?.get(row.id);
      const vis = meta?.visibility ?? row.visibility;
      const disc = meta?.discoverableByHandle ?? true;
      const ok = decideProfileVisibility({
        visibility: vis,
        discoverableByHandle: disc,
        isOwner: row.own === true,
        isFollowed: row.ownerIsFollowed === true,
        isSearch,
      });
      if (!ok) continue;
      out.push(row);
    } else {
      // Studio/social rows: public everywhere; followers rows for followers;
      // private rows only inside the owner's own surfaces (never discover).
      if (row.visibility === "public") out.push(row);
      else if (row.visibility === "followers" && (row.own || row.ownerIsFollowed)) out.push(row);
    }
  }
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Phase 4a — rank: relevance + safety
// ---------------------------------------------------------------------------

export type SortMode = "relevance" | "new" | "popularity" | "price_asc";

export interface RankOptions {
  rows: SearchEntity[];
  query?: string;
  mode?: SortMode;
  caller?: SearchCaller | null;
  limit?: number;
}

/** Light accent/diacritic folding so "kërcimtar" matches "kercimtar". */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s#]/g, "")
    .trim();
}

const KIND_WEIGHT: Record<EntityKind, number> = {
  class: 6,
  course: 6,
  move: 5,
  combo: 5,
  choreography: 4,
  challenge: 3,
  teacher: 3,
  dancer: 2,
  style: 2,
  hashtag: 1,
};

export interface ScoreBreakdown {
  exact: number;
  prefix: number;
  substring: number;
  keyword: number;
  kind: number;
  location: number;
  popularity: number;
  trust: number;
}

export function scoreEntity(row: SearchEntity, opts: { query?: string; caller?: SearchCaller | null }): number {
  const b: ScoreBreakdown = { exact: 0, prefix: 0, substring: 0, keyword: 0, kind: 0, location: 0, popularity: 0, trust: 0 };
  const q = opts.query ? foldText(opts.query) : "";

  if (q) {
    const label = foldText(row.label);
    const qTokens = q.split(/\s+/).filter(Boolean);
    const kw = foldText(row.keywords.join(" "));
    if (label === q) b.exact = 100;
    else if (label.startsWith(q)) b.prefix = 60;
    else if (label.includes(q)) b.substring = 30;
    for (const tok of qTokens) {
      if (label.includes(tok)) b.keyword += 4;
      else if (kw.includes(tok)) b.keyword += 2;
    }
  }

  b.kind = KIND_WEIGHT[row.kind] ?? 0;
  b.popularity = Math.log1p(Math.max(0, row.popularity)) * 2;
  if (row.verified) b.trust += 5;
  if (opts.caller?.location && row.city && row.city === opts.caller.location) b.location = 8;

  return b.exact + b.prefix + b.substring + b.keyword + b.kind + b.location + b.popularity + b.trust;
}

export function rankEntities({ rows, query, mode = "relevance", caller = null, limit = 40 }: RankOptions): SearchEntity[] {
  let ranked: SearchEntity[];
  if (mode === "new") {
    ranked = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  } else if (mode === "popularity") {
    ranked = [...rows].sort((a, b) => b.popularity - a.popularity);
  } else if (mode === "price_asc") {
    ranked = [...rows].sort(
      (a, b) => (a.priceCents ?? Number.MAX_SAFE_INTEGER) - (b.priceCents ?? Number.MAX_SAFE_INTEGER),
    );
  } else {
    ranked = [...rows].sort((a, b) => scoreEntity(b, { query, caller }) - scoreEntity(a, { query, caller }));
  }
  return ranked.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Phase 4b — composite search (scope → collect → rank)
// ---------------------------------------------------------------------------

export interface SearchInput {
  caller: SearchCaller | null;
  rows: SearchEntity[];
  query: string;
  kinds?: EntityKind[];
  mode?: SortMode;
  /** True when the caller explicitly asked for location-filtered results. */
  location?: boolean;
  limit?: number;
  /** Per-row privacy supplement for dancer/teacher rows (wire-provided). */
  profileMeta?: Map<string, { discoverableByHandle: boolean; visibility: Visibility }>;
}

export type SearchOutcome =
  | { ok: true; rows: SearchEntity[]; scope: SearchScope }
  | { ok: false; error: "query_too_short" };

export const ALL_KINDS: EntityKind[] = [
  "class", "course", "move", "combo", "choreography", "challenge", "style", "hashtag", "dancer", "teacher",
];

export function searchEntities(input: SearchInput): SearchOutcome {
  const q = input.query.trim();
  if (q.length < 2) return { ok: false, error: "query_too_short" };
  const scope = decideSearchScope(input.caller);

  let pool = input.rows;
  // Location filter — caller-consent-gated; minors/guests never filter (and
  // never receive) location.
  if (input.location === true && scope.canUseLocation && input.caller?.location) {
    const loc = input.caller.location;
    pool = pool.filter((r) => r.city === loc);
  }

  const kinds = input.kinds && input.kinds.length > 0 ? input.kinds : ALL_KINDS;
  const limit = input.limit ?? 40;

  // Search is a MATCH operation: a row must actually match the query on its
  // label or keywords (folded). Non-matching rows never surface — ranking
  // alone would still show them when the catalog is small.
  const qf = foldText(q.replace(/^#+/, ""));
  const qTokens = qf.split(/\s+/).filter(Boolean);
  const matchesQuery = (r: SearchEntity): boolean => {
    const label = foldText(r.label);
    if (label.includes(qf)) return true;
    const kw = foldText(r.keywords.join(" "));
    return qTokens.some((tok) => label.includes(tok) || kw.includes(tok));
  };
  const matched = pool.filter(matchesQuery);

  const collected: SearchEntity[] = [];
  const seen = new Set<string>();
  for (const kind of kinds) {
    const visible = collectEntities({
      kind,
      caller: input.caller,
      rows: matched,
      limit: 200,
      isSearch: true,
      profileMeta: input.profileMeta,
    });
    const ranked = rankEntities({ rows: visible, query: q, mode: input.mode ?? "relevance", caller: input.caller, limit });
    for (const r of ranked) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      collected.push(r);
    }
  }
  const final = rankEntities({ rows: collected, query: q, mode: input.mode ?? "relevance", caller: input.caller, limit });
  return { ok: true, rows: final, scope };
}

// ---------------------------------------------------------------------------
// Phase 4c — suggestions (typeahead)
// ---------------------------------------------------------------------------

export interface Suggestion {
  text: string;
  kind: EntityKind;
}

/** A query may carry its # — fold it away so "#hiphop" matches tag "hiphop". */
function normalizeQuery(q: string): string {
  return foldText(q.replace(/^#+/, ""));
}

export function suggestFromRows(
  rows: SearchEntity[],
  q: string,
  limit = 8,
  caller?: SearchCaller | null,
  profileMeta?: Map<string, { discoverableByHandle: boolean; visibility: Visibility }>,
): Suggestion[] {
  const query = normalizeQuery(q);
  if (query.length < 2) return [];

  // Same visibility semantics as search: minors get no people suggestions;
  // private profiles surface only via handle discovery; private studio rows
  // never suggest; followers rows suggest only to followers/owner.
  const scope = decideSearchScope(caller ?? null);
  const visible = rows.filter((r) => {
    if (r.flagged && !r.own) return false;
    if (r.kind === "dancer" || r.kind === "teacher") {
      if (!scope.canSearchDancers) return false;
      const meta = profileMeta?.get(r.id);
      return decideProfileVisibility({
        visibility: meta?.visibility ?? r.visibility,
        discoverableByHandle: meta?.discoverableByHandle ?? true,
        isOwner: r.own === true,
        isFollowed: r.ownerIsFollowed === true,
        isSearch: true,
      });
    }
    if (r.visibility === "public") return true;
    return r.visibility === "followers" && (r.own || r.ownerIsFollowed);
  });

  const seen = new Set<string>();
  const out: Suggestion[] = [];
  // Relevant kinds first, then the rest — the fold order below is the priority.
  const order: EntityKind[] = ["class", "course", "move", "combo", "choreography", "challenge", "style", "dancer", "teacher", "hashtag"];
  for (const kind of order) {
    for (const row of visible) {
      if (out.length >= limit) return out;
      if (row.kind !== kind) continue;
      const label = foldText(row.label);
      if (!label.startsWith(query)) continue;
      const text = row.kind === "hashtag" ? `#${row.label}` : row.label;
      if (seen.has(text)) continue;
      seen.add(text);
      out.push({ text, kind: row.kind });
    }
  }
  // Fall back to substring matches when no label starts with the query.
  if (out.length === 0) {
    for (const kind of order) {
      for (const row of visible) {
        if (out.length >= limit) return out;
        if (row.kind !== kind) continue;
        const label = foldText(row.label);
        if (!label.includes(query)) continue;
        const text = row.kind === "hashtag" ? `#${row.label}` : row.label;
        if (seen.has(text)) continue;
        seen.add(text);
        out.push({ text, kind: row.kind });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase 4d — discover rails
// ---------------------------------------------------------------------------

export interface DiscoverSection {
  id: string;
  title: string;
  rows: SearchEntity[];
}

export interface DiscoverOptions {
  caller: SearchCaller | null;
  rows: SearchEntity[];
  now: number;
  /** Age-window for "rising" dancers (default 30 days). */
  risingWindowMs?: number;
  /** Per-row privacy supplement for dancer/teacher rows. */
  profileMeta?: Map<string, { discoverableByHandle: boolean; visibility: Visibility }>;
}

const RAIL_LIMIT = 12;

export function buildDiscoverSections({ caller, rows, now, risingWindowMs = 30 * 864e5, profileMeta }: DiscoverOptions): DiscoverSection[] {
  const scope = decideSearchScope(caller);
  const byKind = (kind: EntityKind, isSearch = false) =>
    collectEntities({ kind, caller, rows, limit: 100, isSearch, profileMeta });

  const sections: DiscoverSection[] = [];
  const add = (id: string, title: string, rows: SearchEntity[]) => {
    if (rows.length > 0) sections.push({ id, title, rows });
  };

  // 🔥 Trending Moves — real demand with a recency boost: fresh rows get +60
  // so a new move with comparable traction outranks a stale one (real scale
  // still dominates — a 200+ popularity veteran outranks any boosted rookie).
  add(
    "trending_moves",
    "Trending Moves",
    rankEntities({
      rows: byKind("move").map((r) => ({
        ...r,
        popularity: r.popularity + (now - r.createdAt < 14 * 864e5 ? 60 : 0),
      })),
      mode: "popularity",
      limit: RAIL_LIMIT,
    }),
  );

  // 🎬 Trending Choreographies
  add("trending_choreos", "Trending Choreographies", rankEntities({ rows: byKind("choreography"), mode: "popularity", limit: RAIL_LIMIT }));

  // 👑 Teachers — verified-first via the trust bonus in relevance ranking.
  add("teachers", "Teachers", rankEntities({ rows: byKind("teacher"), mode: "relevance", caller, limit: RAIL_LIMIT }));

  // ⚡ Challenges — newest live cycles first.
  add("challenges", "Challenges", rankEntities({ rows: byKind("challenge"), mode: "new", limit: RAIL_LIMIT }));

  // 🪩 Dance Styles — derived style rows (real usage counts from the wire).
  add("styles", "Dance Styles", rankEntities({ rows: byKind("style"), mode: "popularity", limit: 16 }));

  // 🎯 Beginner Friendly — learnable entry points across kinds.
  add(
    "beginner",
    "Beginner Friendly",
    rankEntities({
      rows: [...byKind("class"), ...byKind("course"), ...byKind("move"), ...byKind("combo"), ...byKind("challenge")].filter(
        (r) => r.level === "beginner",
      ),
      mode: "popularity",
      limit: RAIL_LIMIT,
    }),
  );

  // 🚀 Rising Dancers — new dancer profiles (adults only; scope-gated).
  if (scope.canSearchDancers) {
    add(
      "rising",
      "Rising Dancers",
      rankEntities({
        rows: byKind("dancer").filter((r) => now - r.createdAt <= risingWindowMs),
        mode: "popularity",
        limit: RAIL_LIMIT,
      }),
    );
  }

  // 🆕 New Classes
  add("new_classes", "New Classes", rankEntities({ rows: byKind("class"), mode: "new", limit: RAIL_LIMIT }));

  // 💰 Under €5 — paid classes/courses below €5 (the paid band starts at €2).
  add(
    "under5",
    "Under €5",
    rankEntities({
      rows: [...byKind("class"), ...byKind("course")].filter((r) => (r.priceCents ?? 0) > 0 && (r.priceCents ?? 0) < 500),
      mode: "price_asc",
      limit: RAIL_LIMIT,
    }),
  );

  // 🆓 Free Classes
  add(
    "free",
    "Free Classes",
    rankEntities({
      rows: [...byKind("class"), ...byKind("course")].filter((r) => r.priceCents === 0),
      mode: "popularity",
      limit: RAIL_LIMIT,
    }),
  );

  return sections;
}

// ---------------------------------------------------------------------------
// Phase 5 — sanitize: the last gate before anything leaves the core
// ---------------------------------------------------------------------------

export interface PublicResult {
  id: string;
  kind: EntityKind;
  label: string;
  subtitle?: string;
  verified?: boolean;
  level?: "beginner" | "intermediate" | "advanced";
  priceCents?: number;
  isFree?: boolean;
  popularity?: number;
  /** Broad city — ONLY for adult signed-in callers, owner-consented rows. */
  city?: string;
}

export function sanitizeResults(rows: SearchEntity[], opts: { caller: SearchCaller | null }): PublicResult[] {
  const scope = decideSearchScope(opts.caller);
  return rows.map((r) => {
    const out: PublicResult = {
      id: r.id,
      kind: r.kind,
      label: r.label,
      subtitle: r.keywords.slice(0, 3).join(" · ") || undefined,
      popularity: r.popularity,
    };
    if (r.verified) out.verified = true;
    if (r.level) out.level = r.level;
    if (r.priceCents !== undefined) {
      out.priceCents = r.priceCents;
      out.isFree = r.priceCents === 0;
    }
    // Broad city display: signed-in ADULT callers may see a row's city —
    // the wire only ever attaches cities whose OWNER consented (showCity).
    // Guests (unknown age) and minors never receive city output. The
    // CALLER's own consent gates the location FILTER (searchEntities), not
    // the display of another dancer's consented city.
    if (scope.canSearchDancers && r.city) out.city = r.city;
    return out;
  });
}
