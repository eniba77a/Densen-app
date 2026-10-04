/**
 * Day 17 — discover core unit tests (pure functions, no backend).
 *
 * Covers: search scope (minors/guests), private-profile respect, blocked/muted
 * exclusion, ranking determinism + relevance-first ordering, query matching,
 * suggestions, discover rails, and the sanitize gate (no location for
 * minors/guests, owner-consented city only).
 */
import { describe, expect, it } from "vitest";
import {
  buildDiscoverSections,
  collectEntities,
  decideProfileVisibility,
  decideSearchScope,
  foldText,
  rankEntities,
  sanitizeResults,
  scoreEntity,
  searchEntities,
  suggestFromRows,
  type SearchCaller,
  type SearchEntity,
} from "../../convex/discover";

const ADULT: SearchCaller = {
  band: "adult",
  userId: "u_me",
  followingIds: ["u_friend"],
  locationEnabled: false,
};

const ADULT_LOC: SearchCaller = {
  band: "adult",
  userId: "u_me",
  followingIds: [],
  locationEnabled: true,
  location: "tirana",
};

const MINOR: SearchCaller = {
  band: "teen13_15",
  userId: "u_minor",
  followingIds: ["u_friend"],
  locationEnabled: false,
};

const GUEST = null;

function ent(over: Partial<SearchEntity> & { id: string; kind: SearchEntity["kind"] }): SearchEntity {
  return {
    label: over.id,
    keywords: [],
    popularity: 0,
    createdAt: 1_700_000_000_000,
    visibility: "public",
    ownerId: "u_someone",
    ...over,
  };
}

describe("decideSearchScope", () => {
  it("adults get dancer discovery", () => {
    expect(decideSearchScope(ADULT).canSearchDancers).toBe(true);
  });

  it("minors never get dancer discovery or location, but see all-ages catalog", () => {
    const s = decideSearchScope(MINOR);
    expect(s.canSearchDancers).toBe(false);
    expect(s.canUseLocation).toBe(false);
    expect(s.allAgesOnly).toBe(true);
  });

  it("location requires explicit consent", () => {
    expect(decideSearchScope(ADULT_LOC).canUseLocation).toBe(true);
    expect(decideSearchScope(ADULT).canUseLocation).toBe(false);
  });

  it("guests are all-ages with no dancer search (unknown age ⇒ fail-safe)", () => {
    const s = decideSearchScope(GUEST);
    expect(s.guest).toBe(true);
    expect(s.canSearchDancers).toBe(false);
    expect(s.allAgesOnly).toBe(true);
  });

  it("child band is fully locked down", () => {
    const s = decideSearchScope({ ...ADULT, band: "child_u13" });
    expect(s.canSearchDancers).toBe(false);
    expect(s.canUseLocation).toBe(false);
    expect(s.allAgesOnly).toBe(true);
  });
});

describe("decideProfileVisibility — private profiles", () => {
  const base = { isOwner: false, isFollowed: false, isSearch: true };

  it("private profile surfaces to nobody by default — not even rails", () => {
    expect(decideProfileVisibility({ ...base, visibility: "private", discoverableByHandle: false })).toBe(false);
    expect(decideProfileVisibility({ ...base, visibility: "private", discoverableByHandle: true, isSearch: false })).toBe(false);
  });

  it("private+discoverable profile surfaces ONLY in search (handle discovery)", () => {
    expect(
      decideProfileVisibility({ ...base, visibility: "private", discoverableByHandle: true, isSearch: true }),
    ).toBe(true);
  });

  it("owner always sees their own profile", () => {
    expect(decideProfileVisibility({ ...base, isOwner: true, visibility: "private", discoverableByHandle: false })).toBe(true);
  });

  it("followers profiles surface to followers in search AND rails", () => {
    expect(decideProfileVisibility({ ...base, visibility: "followers", discoverableByHandle: true, isFollowed: true, isSearch: true })).toBe(true);
    expect(decideProfileVisibility({ ...base, visibility: "followers", discoverableByHandle: true, isFollowed: true, isSearch: false })).toBe(true);
    expect(decideProfileVisibility({ ...base, visibility: "followers", discoverableByHandle: true, isFollowed: false, isSearch: true })).toBe(false);
  });

  it("public profiles are visible to everyone", () => {
    expect(decideProfileVisibility({ ...base, visibility: "public", discoverableByHandle: false })).toBe(true);
  });
});

describe("collectEntities", () => {
  const rows: SearchEntity[] = [
    ent({ id: "m1", kind: "move", label: "Two Step", popularity: 10 }),
    ent({ id: "m2", kind: "move", label: "Mature Move", maturity: "mature", popularity: 99 }),
    ent({ id: "m3", kind: "move", label: "Draft Move", visibility: "private" }),
    ent({ id: "m4", kind: "move", label: "Flagged Move", flagged: true }),
    ent({ id: "m5", kind: "move", label: "My Flagged", flagged: true, own: true, ownerId: "u_me" }),
    ent({ id: "f1", kind: "move", label: "Friend Move", visibility: "followers", ownerId: "u_friend", ownerIsFollowed: true }),
    ent({ id: "d1", kind: "dancer", label: "Some Dancer", ownerId: "u_other" }),
  ];

  it("hides drafts, flagged rows and mature content from minors", () => {
    const visible = collectEntities({ kind: "move", caller: MINOR, rows, isSearch: true });
    const ids = visible.map((r) => r.id);
    expect(ids).toContain("m1");
    expect(ids).not.toContain("m2"); // mature
    expect(ids).not.toContain("m3"); // private/draft
    expect(ids).not.toContain("m4"); // flagged
    expect(ids).not.toContain("d1"); // minors: no people results
  });

  it("shows followers-rows to followers, own flagged rows to owner, mature to adults", () => {
    const visible = collectEntities({ kind: "move", caller: ADULT, rows, isSearch: true });
    const ids = visible.map((r) => r.id);
    expect(ids).toContain("f1"); // followed owner
    expect(ids).toContain("m5"); // own flagged row
    expect(ids).toContain("m2"); // mature content IS shown to adults
  });

  it("guests see public rows only (no owner/followers rows — caller-relative flags unset)", () => {
    // own/ownerIsFollowed are caller-derived in the wire; a guest row set has none.
    const guestRows: SearchEntity[] = [
      ent({ id: "m1", kind: "move", label: "Two Step", popularity: 10 }),
      ent({ id: "f1", kind: "move", label: "Friend Move", visibility: "followers", ownerId: "u_friend" }),
      ent({ id: "m4", kind: "move", label: "Flagged Move", flagged: true }),
    ];
    const visible = collectEntities({ kind: "move", caller: GUEST, rows: guestRows, isSearch: true });
    expect(visible.map((r) => r.id)).toEqual(["m1"]);
  });

  it("blocks dancer discovery for guests even on public profiles", () => {
    expect(collectEntities({ kind: "dancer", caller: GUEST, rows, isSearch: true })).toEqual([]);
  });
});

describe("searchEntities — matching + ranking", () => {
  const rows: SearchEntity[] = [
    ent({ id: "c1", kind: "class", label: "Hip Hop Basics", keywords: ["beginner groove"], popularity: 50, priceCents: 0 }),
    ent({ id: "c2", kind: "class", label: "Advanced Hip Hop", popularity: 500, priceCents: 900, level: "advanced" }),
    ent({ id: "mv1", kind: "move", label: "Hip Hop Two Step", popularity: 20 }),
    ent({ id: "mv2", kind: "move", label: "Unrelated Move", popularity: 1000 }),
    ent({ id: "tg1", kind: "hashtag", label: "hiphop", popularity: 30 }),
  ];

  it("query shorter than 2 chars is rejected", () => {
    expect(searchEntities({ caller: ADULT, rows, query: "h" })).toMatchObject({ ok: false, error: "query_too_short" });
  });

  it("only matching rows surface, ranked relevance-first (not popularity-first)", () => {
    const out = searchEntities({ caller: ADULT, rows, query: "hip hop" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const ids = out.rows.map((r) => r.id);
    expect(ids).not.toContain("mv2"); // never matched
    // The exact-label class outranks the higher-popularity advanced class.
    expect(out.rows[0].id).toBe("c1");
  });

  it("kind filter restricts the result kinds", () => {
    const out = searchEntities({ caller: ADULT, rows, query: "hip hop", kinds: ["class"] });
    if (!out.ok) throw new Error("expected ok");
    expect(out.rows.every((r) => r.kind === "class")).toBe(true);
  });

  it("minors get zero people results even when names match", () => {
    const withPeople = [
      ...rows,
      ent({ id: "u1", kind: "dancer", label: "Hip Hop Dancer", ownerId: "u1" }),
    ];
    const out = searchEntities({ caller: MINOR, rows: withPeople, query: "hip hop" });
    if (!out.ok) throw new Error("expected ok");
    expect(out.rows.find((r) => r.kind === "dancer")).toBeUndefined();
  });

  it("location filter applies only with caller consent", () => {
    const withCities = [
      ent({ id: "t1", kind: "teacher", label: "Local Teacher", ownerId: "u_t1", city: "tirana" }),
      ent({ id: "t2", kind: "teacher", label: "Far Teacher", ownerId: "u_t2", city: "berlin" }),
      ent({ id: "t3", kind: "teacher", label: "Any Teacher", ownerId: "u_t3" }),
    ];
    const loc = searchEntities({ caller: ADULT_LOC, rows: withCities, query: "teacher", location: true });
    if (!loc.ok) throw new Error("expected ok");
    expect(loc.rows.map((r) => r.id)).toEqual(["t1"]);

    // Same caller, consent NOT given (rebuild without locationEnabled):
    const noConsent: SearchCaller = { ...ADULT_LOC, locationEnabled: false, location: undefined };
    const unfiltered = searchEntities({ caller: noConsent, rows: withCities, query: "teacher", location: true });
    if (!unfiltered.ok) throw new Error("expected ok");
    expect(unfiltered.rows.length).toBe(3);
  });

  it("private dancers surface via search only when discoverableByHandle", () => {
    const meta = new Map([
      ["u_priv", { discoverableByHandle: true, visibility: "private" as const }],
      ["u_ghost", { discoverableByHandle: false, visibility: "private" as const }],
    ]);
    const people = [
      ent({ id: "u_priv", kind: "dancer", label: "Sara Priv", ownerId: "u_priv" }),
      ent({ id: "u_ghost", kind: "dancer", label: "Ghost Dancer", ownerId: "u_ghost" }),
      ent({ id: "u_pub", kind: "dancer", label: "Sara Public", ownerId: "u_pub" }),
    ];
    const out = searchEntities({ caller: ADULT, rows: people, query: "sara", profileMeta: meta });
    if (!out.ok) throw new Error("expected ok");
    const ids = out.rows.map((r) => r.id);
    expect(ids).toContain("u_pub");
    expect(ids).toContain("u_priv"); // handle-discoverable
    expect(ids).not.toContain("u_ghost"); // fully hidden
  });
});

describe("ranking + folding", () => {
  it("foldText strips diacritics and case", () => {
    expect(foldText("Kërcimtar básic!")).toBe("kercimtar basic");
  });

  it("exact label beats prefix beats keyword", () => {
    const rows = [
      ent({ id: "kw", kind: "move", label: "Something Else", keywords: ["groove"] }),
      ent({ id: "prefix", kind: "move", label: "Groove Master" }),
      ent({ id: "exact", kind: "move", label: "Groove" }),
    ];
    const ranked = rankEntities({ rows, query: "groove" });
    expect(ranked.map((r) => r.id)).toEqual(["exact", "prefix", "kw"]);
  });

  it("verified teacher outranks equally popular unverified one", () => {
    const rows = [
      ent({ id: "a", kind: "teacher", label: "Teacher A", popularity: 100 }),
      ent({ id: "b", kind: "teacher", label: "Teacher B", popularity: 100, verified: true }),
    ];
    const ranked = rankEntities({ rows, query: "teacher" });
    expect(ranked[0].id).toBe("b");
  });

  it("scoreEntity is deterministic and popularity grows monotonically", () => {
    const base = ent({ id: "x", kind: "move", label: "Move" });
    const s1 = scoreEntity(base, { query: "move" });
    const s2 = scoreEntity(base, { query: "move" });
    expect(s1).toBe(s2);
    const more = scoreEntity({ ...base, popularity: base.popularity + 50 }, { query: "move" });
    expect(more).toBeGreaterThanOrEqual(s1);
  });
});

describe("suggestFromRows", () => {
  const rows: SearchEntity[] = [
    ent({ id: "c1", kind: "class", label: "Hip Hop Basics" }),
    ent({ id: "mv1", kind: "move", label: "Hip Roll" }),
    ent({ id: "tg1", kind: "hashtag", label: "hiphop" }),
    ent({ id: "u1", kind: "dancer", label: "Hippy Dancer", ownerId: "u1" }),
    ent({ id: "u2", kind: "dancer", label: "Private Dancer", ownerId: "u2", visibility: "private" }),
  ];

  it("prefix matches, hashtag gets its # prefix, priorities by kind", () => {
    const s = suggestFromRows(rows, "hip");
    expect(s[0].text).toBe("Hip Hop Basics"); // class first
    expect(s.some((x) => x.text === "#hiphop")).toBe(true);
  });

  it("respects privacy: private dancers never suggest", () => {
    const s = suggestFromRows(rows, "private");
    expect(s).toEqual([]);
  });

  it("minors get no people suggestions at all", () => {
    const s = suggestFromRows(rows, "hip", 8, MINOR);
    expect(s.every((x) => x.kind !== "dancer" && x.kind !== "teacher")).toBe(true);
  });

  it("falls back to substring when no prefix matches", () => {
    const s = suggestFromRows([ent({ id: "c9", kind: "class", label: "Super Hip Hop Flow" })], "hop");
    expect(s.map((x) => x.text)).toEqual(["Super Hip Hop Flow"]);
  });
});

describe("buildDiscoverSections", () => {
  const now = 1_750_000_000_000;
  const rows: SearchEntity[] = [
    ent({ id: "mv1", kind: "move", label: "Fresh Move", popularity: 5, createdAt: now - 1000, level: "beginner" }),
    ent({ id: "mv2", kind: "move", label: "Old Move", popularity: 50, createdAt: now - 90 * 864e5 }),
    ent({ id: "ch1", kind: "choreography", label: "Choreo", popularity: 30 }),
    ent({ id: "cl1", kind: "class", label: "Free Class", priceCents: 0, popularity: 10, createdAt: now - 5000 }),
    ent({ id: "cl2", kind: "class", label: "Cheap Class", priceCents: 299, popularity: 10 }),
    ent({ id: "cl3", kind: "class", label: "Rich Class", priceCents: 1500 }),
    ent({ id: "co1", kind: "combo", label: "Beginner Combo", level: "beginner", popularity: 3 }),
    ent({ id: "st1", kind: "style", label: "Hip Hop", popularity: 12 }),
    ent({ id: "d1", kind: "dancer", label: "New Dancer", ownerId: "u_d1", createdAt: now - 864e5, popularity: 4 }),
  ];

  it("builds the brief's rails from real rows", () => {
    const s = buildDiscoverSections({ caller: GUEST, rows, now });
    const ids = s.map((x) => x.id);
    expect(ids).toContain("trending_moves");
    expect(ids).toContain("trending_choreos");
    expect(ids).toContain("styles");
    expect(ids).toContain("beginner");
    expect(ids).toContain("new_classes");
    // Day 23 — free platform: the paid "under5" rail is gone.
    expect(ids).not.toContain("under5");
    expect(ids).toContain("free");
  });

  it("rising dancers rail is age-gated (absent for minors/guests, present for adults)", () => {
    expect(buildDiscoverSections({ caller: GUEST, rows, now }).find((x) => x.id === "rising")).toBeUndefined();
    expect(buildDiscoverSections({ caller: MINOR, rows, now }).find((x) => x.id === "rising")).toBeUndefined();
    expect(buildDiscoverSections({ caller: ADULT, rows, now }).find((x) => x.id === "rising")?.rows.map((r) => r.id)).toEqual(["d1"]);
  });

  it("Day 23: the free rail holds EVERY class (legacy prices no longer exclude)", () => {
    const s = buildDiscoverSections({ caller: GUEST, rows, now });
    expect(s.find((x) => x.id === "free")?.rows.map((r) => r.id).sort()).toEqual(["cl1", "cl2", "cl3"]);
  });

  it("trending boosts fresh moves over historically popular old ones", () => {
    const s = buildDiscoverSections({ caller: GUEST, rows, now });
    const ids = s.find((x) => x.id === "trending_moves")?.rows.map((r) => r.id) ?? [];
    expect(ids).toContain("mv1");
    expect(ids).toContain("mv2");
    expect(ids.indexOf("mv1")).toBeLessThan(ids.indexOf("mv2")); // fresh ranks first
  });

  it("empty rows produce no sections (no fabricated content)", () => {
    expect(buildDiscoverSections({ caller: ADULT, rows: [], now })).toEqual([]);
  });

  it("respects privacy in people rails (private dancers never appear)", () => {
    const privRows = [
      ent({ id: "u_priv", kind: "dancer", label: "Priv", ownerId: "u_priv", visibility: "private", createdAt: now - 1000 }),
      ent({ id: "u_pub", kind: "dancer", label: "Pub", ownerId: "u_pub", createdAt: now - 1000 }),
    ];
    const meta = new Map([
      ["u_priv", { discoverableByHandle: true, visibility: "private" as const }],
      ["u_pub", { discoverableByHandle: true, visibility: "public" as const }],
    ]);
    const s = buildDiscoverSections({ caller: ADULT, rows: privRows, now, profileMeta: meta });
    const rising = s.find((x) => x.id === "rising");
    expect(rising?.rows.map((r) => r.id)).toEqual(["u_pub"]);
  });
});

describe("sanitizeResults — the last gate", () => {
  it("strips city for minors even when the owner consented", () => {
    const rows = [ent({ id: "d1", kind: "dancer", label: "City Dancer", ownerId: "u_d1", city: "tirana" })];
    const out = sanitizeResults(rows, { caller: MINOR });
    expect(out[0].city).toBeUndefined();
  });

  it("strips city for guests", () => {
    const rows = [ent({ id: "d1", kind: "dancer", label: "City Dancer", ownerId: "u_d1", city: "tirana" })];
    expect(sanitizeResults(rows, { caller: GUEST })[0].city).toBeUndefined();
  });

  it("signed-in adults see owner-consented city; caller's own consent gates the FILTER, not display", () => {
    const rows = [ent({ id: "d1", kind: "dancer", label: "City Dancer", ownerId: "u_d1", city: "tirana" })];
    expect(sanitizeResults(rows, { caller: ADULT_LOC })[0].city).toBe("tirana");
    expect(sanitizeResults(rows, { caller: ADULT })[0].city).toBe("tirana");
  });

  it("projects free (never a price) and never leaks the raw keywords field", () => {
    const rows = [
      ent({ id: "cl1", kind: "class", label: "Class", priceCents: 0, keywords: ["secret", "words"] }),
      ent({ id: "cl2", kind: "class", label: "Legacy Paid", priceCents: 900 }),
    ];
    const out = sanitizeResults(rows, { caller: ADULT });
    expect(out[0].isFree).toBe(true);
    expect(out[1].isFree).toBe(true);
    expect("priceCents" in out[0]).toBe(false);
    expect("priceCents" in out[1]).toBe(false);
    expect("keywords" in out[0]).toBe(false);
    expect(out[0].subtitle).toBe("secret · words");
  });
});
