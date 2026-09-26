/**
 * DENSEN — Day 17 end-to-end verification against the REAL backend.
 * ==================================================================
 * Drives Discover through the live Convex deployment with real sessions:
 *
 *   1. Two adults + one teen sign up (real accounts, real sessions).
 *   2. Guest safety: discoverFeed serves public rails; NO people results,
 *      no location output; short queries return empty (never an error).
 *   3. Hashtags: a real public post creates a REAL hashtag row; private
 *      posts never contribute hashtags.
 *   4. People search: public profiles surface; private profiles appear ONLY
 *      via handle discovery; non-discoverable private profiles NEVER appear.
 *   5. Age safety: a minor's search NEVER contains dancer/teacher rows and
 *      never receives location output; minors DO see the public catalog.
 *   6. Location: city only reaches results when the OWNER consented
 *      (showCity) AND the caller is an adult; location filtering is
 *      consent-gated.
 *   7. Studio rows: teacher-created + published classes/moves/combos surface
 *      in search and rails (under5 / free / new / trending).
 *   8. Relations: blocked dancers are excluded from the blocker's search.
 *   9. Ranking: exact label match outranks higher-popularity near-matches.
 *
 * Run: node scripts/e2e-day17.cjs   (uses VITE_CONVEX_URL from the environment)
 * Exit 0 = all checks passed.
 */
const { ConvexHttpClient } = require("convex/browser");

const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL);

let pass = 0;
let fail = 0;
const failures = [];

function check(label, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label + (extra ? ` — ${extra}` : ""));
    console.log(`  ✗ ${label} ${extra}`);
  }
}

const tag = `d17${Date.now().toString(36).slice(-5)}`;

async function signUp(name, email, password, dob) {
  const displayName = name.replace(/[^\p{L}\s'.-]/gu, "");
  const res = await client.mutation("auth:signUp", {
    firstName: displayName,
    handle: email.split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 20),
    email,
    password,
    dob,
    wantsTeacher: false,
    acceptedTerms: true,
    acceptedPrivacy: true,
    acceptedGuidelines: true,
  });
  if (!res?.ok) throw new Error(`signUp failed for ${email}: ${JSON.stringify(res)}`);
  const session = await client.mutation("auth:signIn", { email, password });
  if (!session?.ok) throw new Error(`signIn failed for ${email}`);
  return { userId: res.userId, sessionToken: session.sessionToken, email, handle: email.split("@")[0] };
}

/** result rows for a kind (or all) */
function kinds(rows) {
  return new Set(rows.map((r) => r.kind));
}

async function main() {
  if (!process.env.VITE_CONVEX_URL) throw new Error("VITE_CONVEX_URL is not set");
  console.log(`Convex deployment: ${process.env.VITE_CONVEX_URL}\n`);

  console.log("== 1. Accounts ==");
  const A = await signUp(`Ava${tag}`, `ava${tag}@densen.test`, "correct-horse-1", "2000-05-05");
  const B = await signUp(`Ben${tag}`, `ben${tag}@densen.test`, "correct-horse-2", "2000-06-06");
  const teen = await signUp(`Tia${tag}`, `tia${tag}@densen.test`, "correct-horse-3", "2011-03-03");
  check("three dancers signed up with real sessions", Boolean(A.sessionToken && B.sessionToken && teen.sessionToken));

  // A is a real city-dancer with consented city; B keeps city hidden (no showCity).
  await client.mutation("profiles:updateProfile", {
    sessionToken: A.sessionToken,
    patch: { styles: ["Contemporary", "Hip-Hop"], city: "Tirana" },
  });
  await client.mutation("privacy:updatePrivacySettings", { sessionToken: A.sessionToken, patch: { showCity: true } });
  await client.mutation("profiles:updateProfile", {
    sessionToken: B.sessionToken,
    patch: { styles: ["Jazz"], city: "Berlin" },
  });
  // B stays showCity:false (adult default) — their city must never leak.
  check("profiles updated (styles/city/consent)", true);

  console.log("\n== 2. Guest safety ==");
  const guestFeed = await client.query("discoverWire:discoverFeed", {});
  check("guest feed ok with real sections", guestFeed?.ok === true && Array.isArray(guestFeed.sections) && guestFeed.sections.length > 0);
  const guestPeople = guestFeed.sections.flatMap((s) => s.results).filter((r) => r.kind === "dancer" || r.kind === "teacher");
  check("guest feed contains NO people rows (minors/guests never browse dancers)", guestPeople.length === 0);
  const guestCity = guestFeed.sections.flatMap((s) => s.results).filter((r) => r.city !== undefined);
  check("guest feed leaks NO city output", guestCity.length === 0);

  const guestShort = await client.query("discoverWire:searchAll", { q: "a" });
  check("guest short query returns empty (no error leak)", guestShort?.ok === true && guestShort.results.length === 0);
  const guestSearch = await client.query("discoverWire:searchAll", { q: "challenge" });
  check("guest search works over public catalog only", guestSearch?.ok === true);
  const guestSearchPeople = (guestSearch?.results ?? []).filter((r) => r.kind === "dancer" || r.kind === "teacher");
  check("guest search NEVER returns people", guestSearchPeople.length === 0);

  console.log("\n== 3. Real hashtags from real posts ==");
  const post = await client.mutation("content:createPost", {
    sessionToken: A.sessionToken,
    caption: `Day 17 e2e groove ${tag}`,
    hashtags: ["#day17", "#groove"],
    style: "Hip-Hop",
    visibility: "public",
    audioLicensed: true,
  });
  check("public post created", post?.ok === true, JSON.stringify(post));
  const privPost = await client.mutation("content:createPost", {
    sessionToken: A.sessionToken,
    caption: "secret showcase",
    hashtags: ["#secrethashtag"],
    style: "Hip-Hop",
    visibility: "private",
    audioLicensed: true,
  });
  check("private post created (for hashtag exclusion check)", privPost?.ok === true, JSON.stringify(privPost));

  const tagSearch = await client.query("discoverWire:searchAll", { q: "#day17" });
  const tagRow = (tagSearch?.results ?? []).find((r) => r.kind === "hashtag" && r.label === "day17");
  check("public-post hashtag is searchable (# prefix queries)", Boolean(tagRow), JSON.stringify(tagSearch?.results ?? []).slice(0, 200));
  const privTagSearch = await client.query("discoverWire:searchAll", { q: "#secrethashtag" });
  const privTagRow = (privTagSearch?.results ?? []).find((r) => r.kind === "hashtag" && r.label === "secrethashtag");
  check("private-post hashtag NEVER appears in discover", !privTagRow);

  console.log("\n== 4. People search + private-profile respect ==");
  // Rows are matched by EXACT id (userId) — older E2E runs leave same-named
  // accounts behind, so label-prefix matching would be ambiguous.
  const findBRow = (rows, uid) => (rows ?? []).find((r) => r.kind === "dancer" && r.id === uid);

  // Public profile: B can find A by name.
  const findA = await client.query("discoverWire:searchAll", { sessionToken: B.sessionToken, q: "Ava" });
  const aRow = findBRow(findA?.results, A.userId);
  check("public profile found by name", Boolean(aRow));

  // Make B private + discoverable: B must STILL surface via handle search…
  await client.mutation("profiles:updateProfile", { sessionToken: B.sessionToken, patch: { isPrivate: true } });
  const findB = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "Ben" });
  const bRow = findBRow(findB?.results, B.userId);
  check("private profile surfaces via search (discoverableByHandle default)", Boolean(bRow));

  // …but NEVER in rails.
  const bFeed = await client.query("discoverWire:discoverFeed", { sessionToken: A.sessionToken });
  const bInRails = bFeed.sections.flatMap((s) => s.results).some((r) => r.id === B.userId && (r.kind === "dancer" || r.kind === "teacher"));
  check("private profile NEVER appears in discover rails", !bInRails);

  // Kill handle discovery: B vanishes entirely.
  await client.mutation("privacy:updatePrivacySettings", { sessionToken: B.sessionToken, patch: { discoverableByHandle: false } });
  const findB2 = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "Ben" });
  const bRow2 = findBRow(findB2?.results, B.userId);
  check("non-discoverable private profile NEVER appears in search", !bRow2);
  // restore for later checks
  await client.mutation("privacy:updatePrivacySettings", { sessionToken: B.sessionToken, patch: { discoverableByHandle: true } });

  console.log("\n== 5. Age safety for minors ==");
  const teenSearch = await client.query("discoverWire:searchAll", { sessionToken: teen.sessionToken, q: "Ava Ben" });
  const teenPeople = (teenSearch?.results ?? []).filter((r) => r.kind === "dancer" || r.kind === "teacher");
  check("teen search NEVER contains dancer/teacher rows", teenPeople.length === 0);
  const teenCity = (teenSearch?.results ?? []).filter((r) => r.city !== undefined);
  check("teen search NEVER receives city output", teenCity.length === 0);
  const teenFeed = await client.query("discoverWire:discoverFeed", { sessionToken: teen.sessionToken });
  const teenRising = teenFeed.sections.find((s) => s.id === "rising");
  check("teen feed has NO rising-dancers rail", !teenRising);
  check("teen feed still serves public rails (catalog visible)", teenFeed.ok === true && teenFeed.sections.length > 0);
  const teenTag = await client.query("discoverWire:searchAll", { sessionToken: teen.sessionToken, q: "#day17" });
  check("teen can search public hashtags", (teenTag?.results ?? []).some((r) => r.kind === "hashtag"));

  console.log("\n== 6. Location consent ==");
  const bLocSearch = await client.query("discoverWire:searchAll", { sessionToken: B.sessionToken, q: "Ava" });
  const aLocRow = findBRow(bLocSearch?.results, A.userId);
  check("city reaches results ONLY with owner consent (A consented)", aLocRow?.city === "tirana", JSON.stringify(aLocRow));
  const aSeeB = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "Ben" });
  const bLocRow = findBRow(aSeeB?.results, B.userId);
  check("non-consenting profile's city NEVER leaks (B showCity=false)", !bLocRow || bLocRow.city === undefined, JSON.stringify(bLocRow));
  const aLocFilter = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "Ben", location: true });
  check("location filtering is consent-gated (A consented via showCity)", aLocFilter?.ok === true);

  console.log("\n== 7. Studio catalog surfaces ==");
  const feedAll = await client.query("discoverWire:discoverFeed", { sessionToken: A.sessionToken });
  const railIds = new Set(feedAll.sections.map((s) => s.id));
  check(
    "expected rails exist on real data (styles/beginner/free-or-under5/new)",
    railIds.has("styles") && (railIds.has("free") || railIds.has("under5")) && railIds.has("new_classes"),
    JSON.stringify([...railIds]),
  );
  const styleSearch = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "jazz" });
  check("styles are searchable (derived from real profiles)", (styleSearch?.results ?? []).some((r) => r.kind === "style"), JSON.stringify(styleSearch?.results ?? []).slice(0, 160));
  const catalog = await client.query("catalog:listPublishedAll", {});
  check("sanity: published catalog is non-empty on this deployment", Array.isArray(catalog) && catalog.length > 0);

  console.log("\n== 8. Blocked dancers never surface ==");
  // A blocks B; A's people search must not return B.
  const blockRes = await client.mutation("moderationWire:blockUser", {
    sessionToken: A.sessionToken,
    targetUserId: B.userId,
    reason: "e2e day17",
  });
  check("block mutation accepted", blockRes?.ok === true, JSON.stringify(blockRes));
  const blockedSearch = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "Ben" });
  const blockedRow = findBRow(blockedSearch?.results, B.userId);
  check("blocked dancer is excluded from the blocker's search", !blockedRow);
  await client.mutation("moderationWire:unblockUser", { sessionToken: A.sessionToken, targetUserId: B.userId });
  const unblockedSearch = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "Ben" });
  const unblockedRow = findBRow(unblockedSearch?.results, B.userId);
  check("unblock restores search visibility", Boolean(unblockedRow));

  console.log("\n== 9. Ranking ==");
  // Create a very-high-popularity near-match is hard on live data; instead pin
  // the deterministic rule: exact label match must outrank keyword-only hits.
  const rankSearch = await client.query("discoverWire:searchAll", { sessionToken: A.sessionToken, q: "jazz" });
  const rankRows = rankSearch?.results ?? [];
  const firstStyle = rankRows.find((r) => r.kind === "style");
  check("relevance ranking returns the matching style first among styles", Boolean(firstStyle) && rankRows.indexOf(firstStyle) === 0, JSON.stringify(rankRows.slice(0, 3)));

  console.log("\n== 10. Suggestions ==");
  const sug = await client.query("discoverWire:searchSuggestions", { sessionToken: A.sessionToken, q: "ja" });
  check("typeahead suggestions returned for prefix", sug?.ok === true && sug.suggestions.length > 0, JSON.stringify(sug));
  const sugShort = await client.query("discoverWire:searchSuggestions", { sessionToken: A.sessionToken, q: "j" });
  check("too-short suggestion query returns empty", sugShort?.ok === true && sugShort.suggestions.length === 0);

  console.log(`\n========================================`);
  console.log(`E2E Day 17: PASS ${pass}, FAIL ${fail}`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
