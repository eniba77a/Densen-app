/**
 * DENSEN — Day 15 end-to-end verification against the REAL backend.
 * ================================================================
 * Drives the moderation lifecycle through the live Convex deployment
 * (the same one the preview uses) with real sessions:
 *
 *   1. Three dancers sign up + sign in (real accounts, real sessions).
 *   2. Staff gate: moderationQueue fails CLOSED for a non-staff session
 *      (requireRole throws "FORBIDDEN:moderator" — verified live).
 *   3. Dancer A publishes a post (server publish scan → published).
 *   4. Dancer B reports the post (harassment → high priority); duplicate
 *      report rejected (duplicate_open_report); self-report rejected;
 *      unknown category rejected (closed 11-category vocabulary);
 *      B's myReports shows the row.
 *   5. Block/mute: A blocks C (real blocks row), duplicate + self-block
 *      rejected, safety lists reflect it; mute/unmute likewise.
 *   6. Appeals: a non-affected user cannot appeal; a too-short statement
 *      is rejected. (Full staff-side appeal review is unit-tested on the
 *      pure core; exercising it live needs a staff session.)
 *
 * Run: node scripts/e2e-day15.cjs   (uses VITE_CONVEX_URL from the environment)
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

const tag = `d15${Date.now().toString(36).slice(-5)}`;

async function signUp(name, email, password) {
  // Display names are letters/spaces/hyphen/apostrophe only (server NAME_PATTERN):
  // strip any digits that came from the run tag.
  const displayName = name.replace(/[^\p{L}\s'.-]/gu, "");
  const res = await client.mutation("auth:signUp", {
    firstName: displayName,
    handle: email.split("@")[0].replace(/[^a-z0-9_]/g, "").slice(0, 20),
    email,
    password,
    dob: "2000-05-05",
    wantsTeacher: false,
    acceptedTerms: true,
    acceptedPrivacy: true,
    acceptedGuidelines: true,
  });
  if (!res?.ok) throw new Error(`signUp failed for ${email}: ${JSON.stringify(res)}`);
  const session = await client.mutation("auth:signIn", { email, password });
  if (!session?.ok) throw new Error(`signIn failed for ${email}`);
  return { userId: res.userId, sessionToken: session.sessionToken, email };
}

async function main() {
  if (!process.env.VITE_CONVEX_URL) {
    throw new Error("VITE_CONVEX_URL is not set in the environment");
  }
  console.log(`Convex deployment: ${process.env.VITE_CONVEX_URL}\n`);

  console.log("== 1. Accounts ==");
  const A = await signUp(`DancerA${tag}`, `a${tag}@densen.test`, "correct-horse-1");
  const B = await signUp(`DancerB${tag}`, `b${tag}@densen.test`, "correct-horse-2");
  const C = await signUp(`DancerC${tag}`, `c${tag}@densen.test`, "correct-horse-3");
  check("three dancers signed up with real sessions", Boolean(A.sessionToken && B.sessionToken && C.sessionToken));

  console.log("== 2. Staff gate fails closed ==");
  let staffError = "";
  try {
    await client.query("moderationWire:moderationQueue", { sessionToken: A.sessionToken });
  } catch (err) {
    staffError = err instanceof Error ? err.message : String(err);
  }
  check("moderation queue throws FORBIDDEN:moderator for non-staff", staffError.includes("FORBIDDEN:moderator"), staffError);

  // Day 15 — every staff WRITE path must fail closed for non-staff too (the
  // audit and appeal queues are read gates; these are the action gates).
  let actionGateError = "";
  try {
    await client.mutation("moderationWire:takeModerationAction", {
      sessionToken: A.sessionToken,
      reportId: "jv_not_a_report",
      action: "hide",
    });
  } catch (err) {
    actionGateError = err instanceof Error ? err.message : String(err);
  }
  check("takeModerationAction throws FORBIDDEN:moderator for non-staff", actionGateError.includes("FORBIDDEN:moderator"), actionGateError);

  let appealGateError = "";
  try {
    await client.mutation("moderationWire:reviewAppeal", {
      sessionToken: A.sessionToken,
      appealId: "jv_not_an_appeal",
      to: "overturned",
    });
  } catch (err) {
    appealGateError = err instanceof Error ? err.message : String(err);
  }
  check("reviewAppeal throws FORBIDDEN:moderator for non-staff", appealGateError.includes("FORBIDDEN:moderator"), appealGateError);

  console.log("== 3. Dancer A publishes a post ==");
  const post = await client.mutation("content:createPost", {
    sessionToken: A.sessionToken,
    caption: `Day 15 e2e groove ${tag}`,
    hashtags: ["#hiphop", "#e2e"],
    style: "Hip Hop",
    visibility: "public",
    audioLicensed: true,
  });
  check("post created (published)", post?.ok === true && post.status === "published", JSON.stringify(post));
  const postId = post?.postId;

  console.log("== 4. Reports ==");
  const rep1 = await client.mutation("moderationWire:submitReport", {
    sessionToken: B.sessionToken,
    targetType: "post",
    targetId: postId,
    category: "harassment",
    details: "e2e: hostile caption",
  });
  check("B reports A's post (harassment → high priority)", rep1?.ok === true && rep1.priority === "high", JSON.stringify(rep1));

  const dup = await client.mutation("moderationWire:submitReport", {
    sessionToken: B.sessionToken,
    targetType: "post",
    targetId: postId,
    category: "spam",
    details: "duplicate",
  });
  check("duplicate open report rejected", dup?.ok === false && dup.error === "duplicate_open_report", JSON.stringify(dup));

  const selfRep = await client.mutation("moderationWire:submitReport", {
    sessionToken: A.sessionToken,
    targetType: "post",
    targetId: postId,
    category: "spam",
    details: "self report attempt",
  });
  check("self-report rejected", selfRep?.ok === false && selfRep.error === "self_report", JSON.stringify(selfRep));

  const unknownCat = await client.mutation("moderationWire:submitReport", {
    sessionToken: B.sessionToken,
    targetType: "user",
    targetId: A.userId,
    category: "not_a_category",
    details: "",
  });
  check("unknown category rejected (closed vocabulary)", unknownCat?.ok === false && unknownCat.error === "unknown_category", JSON.stringify(unknownCat));

  const myReportsB = await client.query("moderationWire:myReports", { sessionToken: B.sessionToken });
  check("B's report list shows the report", myReportsB?.ok === true && myReportsB.reports.length >= 1, JSON.stringify(myReportsB?.reports?.length));

  // Day 15 — child-safety intake: always CRITICAL priority + specialist queue.
  const csRep = await client.mutation("moderationWire:submitReport", {
    sessionToken: B.sessionToken,
    targetType: "user",
    targetId: A.userId,
    category: "child_safety",
    details: "e2e: child-safety escalation check",
  });
  check("child-safety report is CRITICAL + child_safety queue", csRep?.ok === true && csRep.priority === "critical" && csRep.queue === "child_safety", JSON.stringify(csRep));

  // Rate limiting: REPORTS_PER_HOUR (10) per reporter. B already has 2 live
  // reports, so A publishes 12 distinct posts and B reports each once —
  // reports 3–10 succeed, the 11th must hit the window cap. (All probes on
  // one target would trip duplicate_open_report before the rate limit.)
  let limited = null;
  for (let i = 0; i < 12; i++) {
    const probePost = await client.mutation("content:createPost", {
      sessionToken: A.sessionToken,
      caption: `e2e rate-limit probe post ${i} ${tag}`,
      hashtags: ["#e2e"],
      style: "Hip Hop",
      visibility: "public",
      audioLicensed: true,
    });
    if (probePost?.ok !== true) {
      check("rate-limit probe setup (createPost)", false, JSON.stringify(probePost));
      break;
    }
    limited = await client.mutation("moderationWire:submitReport", {
      sessionToken: B.sessionToken,
      targetType: "post",
      targetId: probePost.postId,
      category: "other",
      details: `e2e rate-limit probe ${i}`,
    });
    if (limited?.ok === false) break;
  }
  check("11th report within the window is rate limited", limited?.ok === false && limited.error === "rate_limited", JSON.stringify(limited));

  console.log("== 5. Block / mute ==");
  const blockRes = await client.mutation("moderationWire:blockUser", { sessionToken: A.sessionToken, targetUserId: C.userId });
  check("A blocks C", blockRes?.ok === true, JSON.stringify(blockRes));
  const blockAgain = await client.mutation("moderationWire:blockUser", { sessionToken: A.sessionToken, targetUserId: C.userId });
  check("duplicate block rejected", blockAgain?.ok === false && blockAgain.error === "already_blocked", JSON.stringify(blockAgain));
  const selfBlock = await client.mutation("moderationWire:blockUser", { sessionToken: A.sessionToken, targetUserId: A.userId });
  check("self-block rejected", selfBlock?.ok === false && selfBlock.error === "self_block", JSON.stringify(selfBlock));

  const listsA = await client.query("moderationWire:mySafetyLists", { sessionToken: A.sessionToken });
  check("A's block list contains C", listsA?.ok === true && listsA.blocked.some((p) => p.userId === C.userId), JSON.stringify(listsA));

  const muteRes = await client.mutation("moderationWire:muteUser", { sessionToken: A.sessionToken, targetUserId: C.userId });
  check("A mutes C", muteRes?.ok === true, JSON.stringify(muteRes));
  const listsA2 = await client.query("moderationWire:mySafetyLists", { sessionToken: A.sessionToken });
  check("A's mute list contains C", listsA2?.ok === true && listsA2.muted.some((p) => p.userId === C.userId), JSON.stringify(listsA2));

  const unblock = await client.mutation("moderationWire:unblockUser", { sessionToken: A.sessionToken, targetUserId: C.userId });
  const unmute = await client.mutation("moderationWire:unmuteUser", { sessionToken: A.sessionToken, targetUserId: C.userId });
  check("unblock + unmute succeed", unblock?.ok === true && unmute?.ok === true, JSON.stringify({ unblock, unmute }));

  console.log("== 6. Appeals (affected-user gates) ==");
  const earlyAppeal = await client.mutation("moderationWire:submitAppeal", {
    sessionToken: B.sessionToken,
    targetType: "post",
    targetId: postId,
    statement: "B tries to appeal A's content — should be denied",
  });
  check("non-affected user cannot appeal", earlyAppeal?.ok === false, JSON.stringify(earlyAppeal));

  const shortAppeal = await client.mutation("moderationWire:submitAppeal", {
    sessionToken: A.sessionToken,
    targetType: "post",
    targetId: postId,
    statement: "short",
  });
  check("too-short statement rejected", shortAppeal?.ok === false && shortAppeal.error === "invalid_statement", JSON.stringify(shortAppeal));

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(` - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main()
  .then(() => undefined)
  .catch((err) => {
    console.error("E2E ERROR:", err && err.message ? err.message : err);
    process.exit(1);
  });
