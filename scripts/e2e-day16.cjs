/**
 * DENSEN — Day 16 end-to-end verification against the REAL backend.
 * ================================================================
 * Drives messaging + notifications through the live Convex deployment
 * (the same one the preview uses) with real sessions:
 *
 *   1. Two adults + one teen sign up + sign in (real accounts, real sessions).
 *   2. Notification defaults: fresh accounts get a notificationPrefs row;
 *      teens start with a quiet inbox; security can NEVER be muted.
 *   3. Search: A finds B by handle; too-short queries fail; nobody finds self.
 *   4. DM: A → B text message delivers (lazy conversation creation), the
 *      conversation shows unread for B, marking read clears it.
 *   5. Age gates: adult → unknown teen denied (adult_to_minor); blocked
 *      relationships deny delivery (absolute).
 *   6. Notifications: the DM raises a pref-checked notification for B; after
 *      B mutes the `messages` category, new DMs write NO notification row;
 *      unmuting restores delivery. Mark-all-read clears unread state.
 *
 * Run: node scripts/e2e-day16.cjs   (uses VITE_CONVEX_URL from the environment)
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

const tag = `d16${Date.now().toString(36).slice(-5)}`;

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
  if (!process.env.VITE_CONVEX_URL) {
    throw new Error("VITE_CONVEX_URL is not set in the environment");
  }
  console.log(`Convex deployment: ${process.env.VITE_CONVEX_URL}\n`);

  console.log("== 1. Accounts ==");
  const A = await signUp(`DancerA${tag}`, `a${tag}@densen.test`, "correct-horse-1", "2000-05-05");
  const B = await signUp(`DancerB${tag}`, `b${tag}@densen.test`, "correct-horse-2", "2000-06-06");
  const teen = await signUp(`Teen${tag}`, `teen${tag}@densen.test`, "correct-horse-3", "2011-03-03");
  check("three dancers signed up with real sessions", Boolean(A.sessionToken && B.sessionToken && teen.sessionToken));

  // A faithful account-holder action, not a backend change: the adult default is
  // messagesFrom:"followers" (privacy-first), so B opens their own inbox first —
  // the same toggle the Settings screen writes via privacy:updatePrivacySettings.
  await client.mutation("privacy:updatePrivacySettings", {
    sessionToken: B.sessionToken,
    patch: { messagesFrom: "everyone" },
  });
  // The 13–15 band defaults to messagesFrom:"none"; a 15-year-old MAY open
  // their inbox to followed dancers ("everyone" is clamped to "followers" for
  // minors by decidePrivacyUpdate). Needed so the adult→teen deny below is the
  // PLATFORM's adult_to_minor gate, not the teen's personal setting.
  await client.mutation("privacy:updatePrivacySettings", {
    sessionToken: teen.sessionToken,
    patch: { messagesFrom: "everyone" },
  });

  console.log("\n== 2. Notification defaults ==");
  const teenPrefs = await client.query("notificationsWire:getNotificationPrefs", { sessionToken: teen.sessionToken });
  check(
    "teen prefs row exists with age-aware mutes",
    teenPrefs?.ok === true && Array.isArray(teenPrefs.mutedCategories) && teenPrefs.mutedCategories.length > 0,
    JSON.stringify(teenPrefs)
  );
  check("security never appears in a teen's mutes", teenPrefs?.ok ? !teenPrefs.mutedCategories.includes("security") : false);
  const adultPrefs = await client.query("notificationsWire:getNotificationPrefs", { sessionToken: A.sessionToken });
  check("adult starts with all categories on", adultPrefs?.ok === true && adultPrefs.mutedCategories.length === 0, JSON.stringify(adultPrefs));

  let securityDenied = false;
  try {
    const res = await client.mutation("notificationsWire:setNotificationPref", { sessionToken: A.sessionToken, category: "security", enable: false });
    securityDenied = res?.ok === false && res?.error === "security_immutable";
  } catch {
    securityDenied = true; // some deployments throw on boundary validation
  }
  check("security category can NEVER be muted", securityDenied);

  console.log("\n== 3. User search ==");
  const shortQ = await client.query("messagingWire:searchUsers", { sessionToken: A.sessionToken, q: "b" });
  check("1-char query is rejected (no scraping)", shortQ?.ok === false && shortQ.error === "query_too_short", JSON.stringify(shortQ));
  const found = await client.query("messagingWire:searchUsers", { sessionToken: A.sessionToken, q: B.email.split("@")[0] });
  check("A finds B by handle", found?.ok === true && Array.isArray(found.users) && found.users.some((u) => u.userId === B.userId), JSON.stringify(found));
  const selfHidden = await client.query("messagingWire:searchUsers", { sessionToken: A.sessionToken, q: A.email.split("@")[0] });
  check("A never finds themself", selfHidden?.ok === true && !selfHidden.users.some((u) => u.userId === A.userId));
  const badToken = await client.query("messagingWire:searchUsers", { sessionToken: "not-a-real-token", q: "anything" });
  check("search fails closed for invalid sessions", badToken?.ok === false, JSON.stringify(badToken));

  console.log("\n== 4. Direct messages ==");
  const anon = await client.query("messagingWire:listMyConversations", { sessionToken: "not-a-real-token" });
  check("conversation list fails closed for bad tokens", anon?.ok === false, JSON.stringify(anon));

  const sent1 = await client.mutation("messagingWire:sendMessage", {
    sessionToken: A.sessionToken,
    recipientId: B.userId,
    body: `hey B, this is ${tag}`,
  });
  check("A → B text message delivers", sent1?.ok === true && typeof sent1.conversationId === "string", JSON.stringify(sent1));
  const convoId = sent1?.conversationId;

  const bList = await client.query("messagingWire:listMyConversations", { sessionToken: B.sessionToken });
  const bConvo = bList?.ok ? bList.conversations.find((c) => c.id === convoId) : null;
  check("B sees the conversation with unread=1", Boolean(bConvo) && bConvo.unread === 1, JSON.stringify(bList));

  const aView = await client.query("messagingWire:getConversation", { sessionToken: A.sessionToken, conversationId: convoId });
  check("A's own view has unread=0 (own messages never unread)", aView?.ok === true && aView.unread === 0, JSON.stringify(aView?.unread));

  const bView = await client.query("messagingWire:getConversation", { sessionToken: B.sessionToken, conversationId: convoId });
  check("B's thread view shows A's message", bView?.ok === true && bView.messages.some((m) => (m.body ?? "").includes(tag)));

  const strangerRead = await client.query("messagingWire:getConversation", { sessionToken: teen.sessionToken, conversationId: convoId });
  check("a non-member cannot open the thread (not_found)", strangerRead?.ok === false && strangerRead.error === "not_found", JSON.stringify(strangerRead));

  const marked = await client.mutation("messagingWire:markConversationRead", { sessionToken: B.sessionToken, conversationId: convoId });
  check("B marks the thread read", marked?.ok === true, JSON.stringify(marked));
  const bList2 = await client.query("messagingWire:listMyConversations", { sessionToken: B.sessionToken });
  const bConvo2 = bList2?.ok ? bList2.conversations.find((c) => c.id === convoId) : null;
  check("unread clears after the read cursor", bConvo2?.unread === 0, JSON.stringify(bConvo2));

  console.log("\n== 5. Age gates + blocks ==");
  const adultMinor = await client.mutation("messagingWire:sendMessage", {
    sessionToken: A.sessionToken,
    recipientId: teen.userId,
    body: "hello teen dancer",
  });
  check("adult → unknown teen is denied (adult_to_minor)", adultMinor?.ok === false && adultMinor.error === "adult_to_minor", JSON.stringify(adultMinor));

  const block = await client.mutation("moderationWire:blockUser", { sessionToken: A.sessionToken, targetUserId: teen.userId });
  check("A blocks the teen (server block row)", block?.ok === true, JSON.stringify(block));
  const blockedSend = await client.mutation("messagingWire:sendMessage", {
    sessionToken: A.sessionToken,
    recipientId: teen.userId,
    body: "should not deliver",
  });
  check("blocked relationships deny delivery (absolute)", blockedSend?.ok === false && blockedSend.error === "blocked", JSON.stringify(blockedSend));
  await client.mutation("moderationWire:unblockUser", { sessionToken: A.sessionToken, targetUserId: teen.userId });

  console.log("\n== 6. Notifications: pref-checked emit + mute suppression ==");
  const bNotifs1 = await client.query("notificationsWire:listMyNotifications", { sessionToken: B.sessionToken });
  const msgNotif1 = bNotifs1?.ok ? bNotifs1.notifications.find((n) => n.type === "message") : null;
  check("B received a message notification (category messages)", Boolean(msgNotif1) && msgNotif1.category === "messages", JSON.stringify(bNotifs1?.notifications?.slice(0, 3)));
  // The random `tag` appears inside handles/display names by construction
  // (searchTokens derive from them), so scrub the actor identity before the
  // payload scan — what must never appear is the MESSAGE BODY, not the actor.
  const notifNoActor = msgNotif1 ? (({ actor, ...rest }) => JSON.stringify(rest))(msgNotif1) : "";
  check("the notification carries no message body (no PII payloads)", Boolean(msgNotif1) && !notifNoActor.includes(tag));

  const aSelf = await client.query("notificationsWire:listMyNotifications", { sessionToken: A.sessionToken });
  const aSelfMsg = aSelf?.ok ? aSelf.notifications.filter((n) => n.type === "message").length : -1;
  check("A was never notified about their own message (self-notify guard)", aSelfMsg === 0, `count=${aSelfMsg}`);

  const muteRes = await client.mutation("notificationsWire:setNotificationPref", { sessionToken: B.sessionToken, category: "messages", enable: false });
  check("B mutes the messages category", muteRes?.ok === true && muteRes.mutedCategories.includes("messages"), JSON.stringify(muteRes));

  const sent2 = await client.mutation("messagingWire:sendMessage", {
    sessionToken: A.sessionToken,
    recipientId: B.userId,
    body: `second message ${tag} while muted`,
  });
  check("the DM itself still delivers (mutes affect notifications, not mail)", sent2?.ok === true, JSON.stringify(sent2));

  const bNotifs2 = await client.query("notificationsWire:listMyNotifications", { sessionToken: B.sessionToken });
  const msgCount2 = bNotifs2?.ok ? bNotifs2.notifications.filter((n) => n.type === "message").length : -1;
  check("muted category: NO new message notification was written", msgCount2 === 1, `count=${msgCount2}`);

  const unmute = await client.mutation("notificationsWire:setNotificationPref", { sessionToken: B.sessionToken, category: "messages", enable: true });
  check("B unmutes messages again", unmute?.ok === true && !unmute.mutedCategories.includes("messages"), JSON.stringify(unmute));

  const sent3 = await client.mutation("messagingWire:sendMessage", {
    sessionToken: A.sessionToken,
    recipientId: B.userId,
    body: `third message ${tag} after unmute`,
  });
  check("third DM delivers", sent3?.ok === true, JSON.stringify(sent3));
  const bNotifs3 = await client.query("notificationsWire:listMyNotifications", { sessionToken: B.sessionToken });
  const msgCount3 = bNotifs3?.ok ? bNotifs3.notifications.filter((n) => n.type === "message").length : -1;
  check("unmuted category delivers again", msgCount3 === 2, `count=${msgCount3}`);

  const markAll = await client.mutation("notificationsWire:markMyNotificationsRead", { sessionToken: B.sessionToken });
  check("mark-all-read executes", markAll?.ok === true, JSON.stringify(markAll));
  const bNotifs4 = await client.query("notificationsWire:listMyNotifications", { sessionToken: B.sessionToken });
  check("no unread rows remain", bNotifs4?.ok === true && bNotifs4.unread === 0, `unread=${bNotifs4?.unread}`);

  console.log(`\n========================================`);
  console.log(`PASS ${pass}  FAIL ${fail}`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log("========================================");
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("E2E runner crashed:", err);
  process.exit(1);
});
