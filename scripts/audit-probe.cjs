/**
 * DENSEN — Day 20 audit probe (anonymous authorization).
 * Calls sensitive public functions with NO session token and verifies each
 * fails closed (UNAUTHENTICATED / FORBIDDEN / invalid-args), never returning
 * private data or performing a write. Run: node scripts/audit-probe.cjs
 */
const { ConvexHttpClient } = require("convex/browser");

const url = process.env.VITE_CONVEX_URL || "http://127.0.0.1:3210";
const c = new ConvexHttpClient(url);

const probes = [
  ["privacy:updatePrivacySettings", {}],
  ["privacy:getPrivacyCenter", {}],
  ["legal:exportMyData", {}],
  ["legal:setBusinessInfo", { legalName: "X", contactEmail: "a@b.co", supportEmail: "c@d.co" }],
  ["privacy:recordConsent", { terms: true, privacy: true, guidelines: true }],
  ["privacy:requestAccountDeletion", { confirmText: "DELETE" }],
  ["interactions:interact", { kind: "save", targetKind: "class", targetId: "j57" }],
  ["content:createPost", { body: "audit probe", hashtags: [] }],
  ["content:sendMessage", { conversationId: "j57", body: "audit probe" }],
  ["payments:startPurchase", { itemType: "class", itemId: "j57" }],
  ["payments:requestRefund", { purchaseId: "j57", reason: "audit probe" }],
  ["credits:fixCreditBalance", {}],
  ["credits:adminAdjustCredits", { userId: "j57", delta: 100, reason: "audit probe" }],
  ["moderation:submitReport", { targetKind: "post", targetId: "j57", category: "harassment", details: "audit probe" }],
  ["admin:bootstrapFirstAdmin", { email: "probe@audit.test", password: "Str0ngProbe99" }],
];

let denied = 0;
let suspicious = [];

async function main() {
for (const [fn, args] of probes) {
  try {
    const r = await c.mutation(fn, args);
    suspicious.push([fn, JSON.stringify(r).slice(0, 160)]);
    console.log(`✗ OPEN    ${fn} -> ${JSON.stringify(r).slice(0, 140)}`);
  } catch (e) {
    const msg = String((e && e.message) || e);
    denied++;
    console.log(`✓ denied  ${fn} -> ${msg.slice(0, 100)}`);
  }
}

console.log(`\n${denied}/${probes.length} correctly denied anonymously`);
if (suspicious.length > 0) {
  console.log("SUSPECT OPEN FUNCTIONS:");
  for (const [fn, r] of suspicious) console.log(`  ${fn}: ${r}`);
  process.exit(1);
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
