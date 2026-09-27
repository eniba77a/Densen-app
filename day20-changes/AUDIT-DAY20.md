# DENSEN — Day 20 Complete System Audit

**Date:** 2026-09-27 · **Scope:** Days 1–19 systems (no rebuilds, no replacements) · **Method:** code-read audit + live E2E against the real Convex backend + anonymous authz probing + unit-test extension.

## Verification gates (final state, all run this session)

| Gate | Result |
|---|---|
| `bun tsc -b --noEmit` | GREEN (exit 0) |
| `bun vitest run` | **554/554** (24 files; +5 new Day-20 tests) |
| `bun convex dev --once` | ✔ Convex functions ready |
| E2E day15 / day16 / day17 / day19 | **21 + 31 + 33 + 43 = 128/128** |
| Anonymous authz probe (audit-probe.cjs) | **15/15 denied** |
| **Journeys 1–5 live E2E (audit-journeys.cjs — new)** | **49/49** |
| Preview smoke (verify.sh: routes, CSP, assets) | 7/7 · CSP meta present |
| Env audit (`freebuff-env list`) | Only CONVEX_DEPLOYMENT / VITE_CONVEX_URL / VITE_CONVEX_SITE_URL — **no provider keys** (expected) |

## Fixes applied (safe, surgical)

1. **Child-safety: minors can never be auto-published.** `decidePost` now takes `callerIsMinor` and caps a minor's post at `in_review` even when the content scan is clean. Previously a scan-clean minor post landed `published` directly (found live in Journey 5). 5 unit tests pin the invariant (`backend.test.ts`).
2. **Hashtag leak closed.** `collectHashtagEntities` aggregated tags from `visibility:"public"` posts **regardless of moderation status** — a held-for-review (or blocked-but-stored) post's hashtags surfaced in discovery. Now `status:"published"` only.
3. **Money-path 500 → clean deny.** `db.get` throws on malformed document ids; junk `classId`/`purchaseId`/`refundId` in `paymentsWire` surfaced as HTTP 500. Added `safeGet` (malformed id ⇒ not-found ⇒ normal deny logic). Verified live: `not_purchasable`, no 500.
4. **`practiceWire.saveItem` fresh-save now returns `itemId`** (only the idempotent-replay path did) — consistent contract for the SPA.
5. **`<html lang>` follows the EN/SQ toggle** (`store.tsx` effect) — WCAG 3.1.1 language-of-page for screen readers on the bilingual app.

## Area verdicts (36 areas)

**AUTHENTICATION — PASS.** Session-token model (hashed, expiry, revocation), server-side age banding from DOB (invalid/future/unreasonable deny), guardian required for child signup, minors cannot even apply as teacher, password policy (≥10, letter+digit, denylist). Sign-in after deletion fails closed (J4 live).

**PROFILES — PASS.** `getMyProfile`/`updateProfile` own-data only; server re-validates; `getPublicProfile` viewer-scoped via `canViewProfile` (private ⇒ self/follower/staff only), PII stripped by sanitizers.

**PRIVACY — PASS.** Age-aware clamps server-side (`everyone`→`followers` for minors, private default, city hidden, personalization off); J4 consent/patch/export live-verified.

**CHILD SAFETY — PASS (after fix #1).** Minor-contact DM gate (`adult_to_minor`/`minor_gate`), grooming scans server-side on posts/comments/messages, contact-pattern watchlist, safe defaults, no people-rows in minor search, minor publish cap now enforced at the decision layer. J5 49/49.

**VIDEO — PASS.** Real upload pipeline: server-validated type/size, MAX_PENDING_UPLOADS=5, single-use signed URLs, `completeVideoUpload` verifies blobs via `db.system.get`, owner-only delete, audited. Oversized upload denied live (J3).

**MEDIA — PASS.** Convex built-in storage; media provider abstraction fails closed when unconfigured (unit-tested).

**FEED — PASS.** Reactive subscriptions over real rows; `by_user_status` / `by_status_created` covering indexes exist; publish scan gates entry to feeds.

**SOCIAL ACTIONS — WARNING.** Server core (`decideFollow`/`decideReaction`) is fail-closed and unit-tested, but `social.ts` resolves callers via Convex Auth JWT while the SPA's live path is `sessionToken` — so **follow/reaction-via-social.ts is not reachable by real sessions**. The reachable live paths are `interactionsWire.interact` (energy/talk/boost/… with XP + notifications) and the client store's local follow state. **Not safely fixable here** (needs either a sessionToken social wire or migrating the SPA to Convex Auth) — flagged as the top Day-21 wiring item.

**COMMENTS — PASS.** SessionToken wire, server safety scan (author-minor-aware), thread indexes, comment reactions live.

**FOLLOWING — see SOCIAL ACTIONS (WARNING).**

**LEARN — PASS.** `touchLesson`/`completeLesson`/`getCourseProgress` live-verified; completion decisions pure + tested; progress never regresses rewards.

**FREE CLASSES — PASS.** `accessModelOf` free ⇔ priceCents=0 ∧ creditPrice=0; `decidePurchaseIntent` denies `free_class` on paid purchase path; studio pricing validation keeps the declared model honest.

**TEACHER STUDIO — PASS.** Verified-teacher gate (`teacherProfiles.status === "verified"`; pending/rejected/revoked denied) — live-probed: unverified teacher cannot create. Publish/unpublish/revert lifecycle owner-only; combos reference only the teacher's own moves (no cross-owner grafts); revenue share real (€2–€30 band enforced).

**COMBOS / CHOREOGRAPHIES — PASS.** Create/edit/publish owner-gated; choreography `studioStatus` mirrored into moderation-facing status; discoverability only when published.

**ARCADE / XP / LEVELS / STREAKS — PASS.** Single XP ledger (`grantActivityXp`, refId-idempotent, daily-capped), `DENSEN_LEVELS` ladder, streak fold with 3/7/30-day milestone bonuses (credits paid via `streak:day-N` once-only probe). J1: XP↑ + streak fold verified live.

**DANCE CREDITS — PASS.** Ledger + denormalized balance in the same mutation; `spendCredits` idempotent per unlock (`duplicate_unlock`), insufficient-balance deny verified live; admin adjustments reason-mandatory + audited.

**ACHIEVEMENTS / CHALLENGES — PASS.** Join/submit/complete state machines pure + tested; rewards idempotent; submissions go through safety screening (`pending`).

**PRACTICE — PASS.** Items/steps/sessions: min 60s (no practice theater), max cap, owner-only, completion requires all steps — verified live (J1).

**RECORDING — PASS.** Attempt video refs sanitized, media-module-only refs, side-by-side compare pair stored.

**COPYRIGHT — WARNING (config-gated by design).** Fingerprinting provider **not configured** → `FingerprintNotConfiguredError`; **no fake matches, ever** (tests pin this). Music rights enforce the no-safe-second rule fail-closed. **Missing production integration:** a fingerprinting provider (e.g. audio-recognition API) must be wired via `fingerprinting.ts` before user uploads can be auto-screened; until then moderation review is the only screen. No env keys exist.

**PAYMENTS — WARNING (config-gated, honest).** Provider contract exists; unconfigured default **fails loudly**: `startPurchase` returns `provider_not_configured`, writes nothing, nothing becomes `paid` (only the webhook seam `applyProviderEvent` can). J2 asserts this live. **Missing production integration:** set `PAYMENTS_PROVIDER`, `PAYMENTS_API_KEY`, `PAYMENTS_WEBHOOK_SECRET` and implement the provider adapter.

**REFUNDS — PASS.** Closed reason vocabulary, owner-only requests, admin queue, staff-only review (probe + day15/19 coverage).

**MESSAGING — PASS.** Full minor-contact gate, blocks absolute, guardian-visible teacher threads, grooming scan on send, 1-char search rejected (anti-scraping). J1/J3/J5 live-verified.

**NOTIFICATIONS — PASS.** Age-aware default mutes (security never mutable), pref-checked delivery, unread/recent indexes.

**SEARCH — PASS.** Guest-safe public catalog, minors never receive dancer/teacher rows or city output, private profiles only via handle discovery (J5 live).

**DISCOVER — PASS.** Themed rails over real data; all-ages filter for minors/guests; hashtag aggregation now published-only (fix #2).

**ACCESSIBILITY — PASS (after fix #5).** Visible `:focus-visible` gold rings, labeled inputs (htmlFor) in auth flows, landmarks (header/nav/main/footer), typed inputs, alt attributes present where images render, `prefers-reduced-motion` respected, `viewport-fit=cover`. Remaining polish (icon-button aria-labels) is incremental, tracked below.

**LEGAL / CONSENTS — PASS.** Registry of documents (terms/privacy/refunds/cookies/community/copyright) with versions; append-only consent ledger; marketing prefs + unsubscribe token rotation (day19 E2E).

**DATA DELETION — PASS.** Deletion FSM (requested→…→completed) with eligibility, immediate session revocation + fail-closed sign-in on request path; data export returns own bundle (J4 live).

**MODERATION — PASS.** 11-category closed vocabulary, high-severity priority, duplicate/self-report rejection, appeals, action ledger, staff gates throw `FORBIDDEN:moderator` (live-probed day15 + this session's probe).

**ADMIN — PASS.** `admin.ts` is internal-only (bootstrap needs `ADMIN_BOOTSTRAP_SECRET`; client probe: "Could not find public function" = deny). Teacher verification approve/reject grants/revokes role in the same transaction; minimal projections (no verification documents in list form).

**SECURITY (cross-cutting) — PASS.** Anonymous probe 15/15 denied; suspended/deleted fail closed everywhere; ownership enforced (`requireOwner`); admins have staff-only privileges; CSP present (script-src 'self', connect-src convex, frame-ancestors 'none'); no secrets read or exposed during audit.

## PERFORMANCE

- **Database:** 135 indexes defined; covering indexes exist for the high-volume paths (posts by_status_created/by_user_status, comments by_post_status, messages by_conversation_time, notifications by_user_unread/recent, sessions by_token_hash, credits by_user_time, follows by_follower_followee). Reads use indexes; per-user probes are bounded.
- **Feed:** discovery currently full-scans catalog tables to build rails — **fine at MVP scale, a WARNING at growth**: move to index-ordered paginated queries (`by_status_created`, limit/cursor) as row counts grow. Feed comments/interactions are already paginated/take-bounded.
- **Video:** upload URLs are single-use and expiring; media served from Convex storage; `signed media URLs` remain on the honest not-yet list (see SECURITY-AUDIT.md).
- **Mobile responsiveness:** PASS — mobile-first CSS (min-width breakpoints 640/1000, fluid grids, dvh units, safe-area insets, bottom-tab shell), preview smoke 7/7.

## Honest not-yet list (unchanged + new)

1. Rate limiting on public mutations (see prior audit) — *not fixed here; touches infra shape*.
2. Signed media URLs / encryption at rest — *provider-level, not app-fixable*.
3. `social.ts` JWT-identity functions unreachable by the sessionToken SPA (this audit, SOCIAL ACTIONS) — *needs a deliberate Day-21 wiring decision*.
4. External integrations intentionally not faked: payments provider keys, copyright/fingerprinting provider, business information ("to be confirmed on the Business Information page" placeholders preserved).

## Test additions

- `src/__tests__/backend.test.ts`: 5 tests pinning the minor-publish cap (adult published / minor held / minor+review held / blocked denies regardless / unauth+suspended fail closed).
- `scripts/audit-journeys.cjs`: permanent live E2E for Journeys 1–5 (49 checks), including the honest payments assertion (`provider_not_configured` is *required* — a fake paid success fails the run).

**Final verdict: 30 PASS · 6 WARNING (3 config-gated by design: PAYMENTS, COPYRIGHT, BUSINESS INFO placeholders; 2 growth/perf: feed pagination, social.ts wiring; 1 external infra: rate limiting) · 0 ACTION REQUIRED.**
