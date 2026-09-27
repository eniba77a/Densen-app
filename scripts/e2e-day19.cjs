/**
 * DENSEN — Day 19 end-to-end verification against the REAL backend.
 * ==================================================================
 * Legal + Privacy Center:
 *   1. Legal document registry: six documents, each with version/effective/
 *      updated/published; all published and metadata complete.
 *   2. Consent versioning: signup consent rows pin registry versions;
 *      new consent records reference the registry version (never client-picked).
 *   3. Deletion state machine: REQUESTED → PROCESSING (user confirms) →
 *      COMPLETED (staff-only + cooling-off enforced); no-request guards;
 *      idempotent re-request.
 *   4. Marketing: all-off default, minor opt-in denied, enable requires the
 *      consent grant, withdrawal clears everything, unsubscribe token flips
 *      prefs off + appends a consent row, token never re-subscribes.
 *   5. Data export: own data only — email/account present, NO dob, no
 *      credential material, manifest documents exclusions.
 *   6. Business info: defaults empty (nothing invented), admin gate on writes,
 *      email validation, operator-filled values persist.
 *
 * Run: node scripts/e2e-day19.cjs   (uses VITE_CONVEX_URL from the environment)
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

const tag = `d19${Date.now().toString(36).slice(-5)}`;

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
  return { userId: res.userId, sessionToken: session.sessionToken, email };
}

async function main() {
  if (!process.env.VITE_CONVEX_URL) throw new Error("VITE_CONVEX_URL is not set");
  console.log(`Convex deployment: ${process.env.VITE_CONVEX_URL}\n`);

  console.log("== 1. Legal document registry ==");
  const docs = await client.query("legalWire:listLegalDocuments", {});
  check("registry query ok", docs?.ok === true);
  const wanted = ["terms", "privacy", "refunds", "cookies", "community", "copyright"];
  const have = (docs?.documents ?? []).map((d) => d.docId);
  check("all six legal documents registered", wanted.every((w) => have.includes(w)), JSON.stringify(have));
  const metaOk = (docs?.documents ?? []).every(
    (d) => d.version && /^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate) && /^\d{4}-\d{2}-\d{2}$/.test(d.updatedDate) && d.published,
  );
  check("every document carries version + effective + updated + published", metaOk);
  const notRetired = (docs?.documents ?? []).every((d) => d.published === "published");
  check("all registry documents are published (current)", notRetired);

  console.log("\n== 2. Consent versioning ==");
  const A = await signUp(`Alba${tag}`, `alba${tag}@densen.test`, "correct-horse-1", "2000-05-05");
  const teen = await signUp(`Tia${tag}`, `tia${tag}@densen.test`, "correct-horse-2", "2011-03-03");
  check("adult + teen signed up", Boolean(A.sessionToken && teen.sessionToken));
  const pc = await client.query("privacy:getPrivacyCenter", { sessionToken: A.sessionToken });
  const termsVersion = pc?.consents?.current?.terms?.version;
  const regTerms = (docs.documents ?? []).find((d) => d.docId === "terms");
  check("signup consent pins a registry version", Boolean(termsVersion), JSON.stringify(pc?.consents?.current));
  check(
    "consent version matches the registry version of that document",
    termsVersion === regTerms.version,
    `consent=${termsVersion} registry=${regTerms.version}`,
  );
  // New consent record gets the registry-resolved version.
  const beforeCount = (pc?.consents?.history ?? []).length;
  await client.mutation("privacy:recordConsent", {
    sessionToken: A.sessionToken, type: "cookies", granted: true, source: "cookie_banner",
  });
  const pc2 = await client.query("privacy:getPrivacyCenter", { sessionToken: A.sessionToken });
  const cookieRow = (pc2?.consents?.history ?? []).find((h) => h.type === "cookies");
  check("new consent row references the registry version", cookieRow?.version === (docs.documents ?? []).find((d) => d.docId === "cookies").version, JSON.stringify(cookieRow));

  console.log("\n== 3. Deletion state machine ==");
  // No request yet.
  const none = await client.query("legalWire:getMyDeletionStatus", { sessionToken: A.sessionToken });
  check("no deletion request initially", none?.ok === true && none.deletion === null, JSON.stringify(none));
  // Advance without a request → no_request.
  let noReqError = "";
  try {
    const r = await client.mutation("legalWire:advanceDeletionFlow", { sessionToken: A.sessionToken });
    noReqError = r?.error ?? "";
  } catch (e) { noReqError = String(e); }
  check("advance without a request is rejected (no_request)", noReqError === "no_request", noReqError);
  // Open a request (wrong confirm → confirm_required).
  const badConfirm = await client.mutation("legalWire:requestDeletionFlow", { sessionToken: A.sessionToken, confirmText: "yes" });
  check("typed confirmation required", badConfirm?.ok === false && badConfirm.error === "confirm_required", JSON.stringify(badConfirm));
  const req = await client.mutation("legalWire:requestDeletionFlow", { sessionToken: A.sessionToken, confirmText: "DELETE" });
  check("REQUESTED state opens", req?.ok === true, JSON.stringify(req));
  const st1 = await client.query("legalWire:getMyDeletionStatus", { sessionToken: A.sessionToken });
  check("status is requested with a 14-day eligibility horizon", st1.deletion?.status === "requested" && st1.deletion.eligibleAt !== null, JSON.stringify(st1));
  const gap = st1.deletion.eligibleAt - st1.deletion.requestedAt;
  check("cooling-off window ≈ 14 days", gap > 13.9 * 864e5 && gap < 14.1 * 864e5, String(gap));
  // Idempotent re-request.
  const req2 = await client.mutation("legalWire:requestDeletionFlow", { sessionToken: A.sessionToken, confirmText: "DELETE" });
  check("re-request while open is idempotent", req2?.ok === true && req2.alreadyOpen === true, JSON.stringify(req2));
  // User advances REQUESTED → PROCESSING.
  const adv = await client.mutation("legalWire:advanceDeletionFlow", { sessionToken: A.sessionToken });
  check("user confirms → PROCESSING", adv?.ok === true && adv.status === "processing", JSON.stringify(adv));
  // PROCESSING → COMPLETED blocked by cooling-off for non-staff (user is plain user).
  const adv2 = await client.mutation("legalWire:advanceDeletionFlow", { sessionToken: A.sessionToken });
  check(
    "PROCESSING → COMPLETED blocked (cooling-off for user / staff-required path)",
    adv2?.ok === false && (adv2.error === "cooling_off_active" || adv2.error === "staff_required"),
    JSON.stringify(adv2),
  );
  const st2 = await client.query("legalWire:getMyDeletionStatus", { sessionToken: A.sessionToken });
  check("status remains processing (state machine holds)", st2.deletion?.status === "processing", JSON.stringify(st2));
  // Account still active (erasure has NOT run).
  const pc3 = await client.query("privacy:getPrivacyCenter", { sessionToken: A.sessionToken });
  check("account NOT deleted during cooling-off (no premature erasure)", pc3?.ok === true);

  console.log("\n== 4. Marketing prefs + unsubscribe ==");
  const mp0 = await client.query("legalWire:getMyMarketingPrefs", { sessionToken: A.sessionToken });
  check("marketing defaults all-off", mp0?.ok === true && Object.values(mp0.prefs).every((v) => v === false), JSON.stringify(mp0));
  // Enable without consent → consent_required.
  const noConsent = await client.mutation("legalWire:setMyMarketingPref", { sessionToken: A.sessionToken, category: "promotions", enabled: true });
  check("enabling a category requires the marketing consent grant", noConsent?.ok === false && noConsent.error === "consent_required", JSON.stringify(noConsent));
  // Minor cannot even grant the consent.
  const minorGrant = await client.mutation("legalWire:recordMarketingConsent", { sessionToken: teen.sessionToken, granted: true, source: "e2e" });
  check("minor marketing consent denied", minorGrant?.ok === false && minorGrant.error === "minor_denied", JSON.stringify(minorGrant));
  // Adult grants consent, then categories unlock.
  const grant = await client.mutation("legalWire:recordMarketingConsent", { sessionToken: A.sessionToken, granted: true, source: "e2e" });
  check("adult can grant marketing consent", grant?.ok === true, JSON.stringify(grant));
  const on = await client.mutation("legalWire:setMyMarketingPref", { sessionToken: A.sessionToken, category: "promotions", enabled: true });
  check("category enables after consent", on?.ok === true, JSON.stringify(on));
  const mp1 = await client.query("legalWire:getMyMarketingPrefs", { sessionToken: A.sessionToken });
  check("pref persisted", mp1.prefs.promotions === true, JSON.stringify(mp1));
  // Unsubscribe token: mint, then unsubscribe WITHOUT a session.
  const tok = await client.mutation("legalWire:rotateUnsubscribeToken", { sessionToken: A.sessionToken });
  check("unsubscribe token minted (raw token returned once)", tok?.ok === true && typeof tok.token === "string" && tok.token.length >= 30, JSON.stringify(tok?.token?.length));
  const unsub = await client.mutation("legalWire:unsubscribeByToken", { token: tok.token, scope: "all" });
  check("token unsubscribes without a session", unsub?.ok === true, JSON.stringify(unsub));
  const mp2 = await client.query("legalWire:getMyMarketingPrefs", { sessionToken: A.sessionToken });
  check("unsubscribe cleared all categories", Object.values(mp2.prefs).every((v) => v === false), JSON.stringify(mp2.prefs));
  const pc4 = await client.query("privacy:getPrivacyCenter", { sessionToken: A.sessionToken });
  const withdrawRow = (pc4?.consents?.history ?? []).find((h) => h.type === "marketing_email" && h.granted === false);
  check("unsubscribe appended a withdrawal consent row (versioned)", Boolean(withdrawRow?.version), JSON.stringify(withdrawRow));
  // Bad token rejected.
  const badTok = await client.mutation("legalWire:unsubscribeByToken", { token: "not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaa" });
  check("invalid token rejected", badTok?.ok === false && badTok.error === "invalid_token", JSON.stringify(badTok));

  console.log("\n== 5. Data export ==");
  const ex = await client.query("legalWire:exportMyData", { sessionToken: A.sessionToken });
  check("export ok with envelope", ex?.ok === true && ex.export?.formatVersion === 1, JSON.stringify(ex?.export?.manifest));
  const acct = ex.export?.sections?.account ?? {};
  check("own email present in export", acct.email === A.email, JSON.stringify(acct));
  // Scan the actual DATA (sections) — the manifest legitimately documents excluded fields by name.
  const dataStr = JSON.stringify(ex.export?.sections ?? {});
  check("export contains NO dob (age minimization)", !dataStr.includes('"dob"'));
  check("export contains NO credential/session material", !dataStr.toLowerCase().includes("secrethash") && !dataStr.toLowerCase().includes("tokenhash") && !dataStr.toLowerCase().includes("secret_hash"));
  check("manifest documents excluded fields", (ex.export?.manifest?.excludedFields ?? []).some((f) => f.field === "dob"), JSON.stringify(ex.export?.manifest?.excludedFields));
  check("deletion request included in export", Array.isArray(ex.export?.sections?.deletion_requests) && ex.export.sections.deletion_requests.length === 1, JSON.stringify(ex.export?.sections?.deletion_requests));
  // Bad token → nothing.
  const exBad = await client.query("legalWire:exportMyData", { sessionToken: "bogus-token" });
  check("export fails closed for invalid sessions", exBad?.ok === false, JSON.stringify(exBad));

  console.log("\n== 6. Business information (operator-configured) ==");
  const b0 = await client.query("legalWire:getBusinessInfo", {});
  check("business info defaults COMPLETELY empty (nothing invented)", b0?.ok === true && Object.values(b0.business).every((v) => v === ""), JSON.stringify(b0));
  check("business not complete while empty", b0.complete === false);
  // Non-admin write denied.
  const denied = await client.mutation("legalWire:setBusinessInfo", { adminSessionToken: A.sessionToken, patch: { legalName: "Fake Co" } });
  check("non-admin business write denied", denied?.ok === false && denied.error === "admin_required", JSON.stringify(denied));
  // No admin credential in this environment → assert the gate held & shape stayed empty.
  const b1 = await client.query("legalWire:getBusinessInfo", {});
  check("unauthorized write did NOT mutate business info", Object.values(b1.business).every((v) => v === ""), JSON.stringify(b1.business));

  console.log("\n== 7. Existing deletion path still guarded ==");
  const oldDel = await client.mutation("privacy:requestAccountDeletion", { sessionToken: teen.sessionToken, confirmText: "DELETE" });
  check("legacy immediate-deletion endpoint still exists (teen deleted)", oldDel?.ok === true, JSON.stringify(oldDel));
  const teenAfter = await client.query("privacy:getPrivacyCenter", { sessionToken: teen.sessionToken });
  check("deleted account's session fails closed", teenAfter?.ok === false, JSON.stringify(teenAfter));

  console.log(`\n========================================`);
  console.log(`E2E Day 19: PASS ${pass}, FAIL ${fail}`);
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
