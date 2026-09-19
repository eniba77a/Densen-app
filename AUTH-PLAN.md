# DENSEN — Authentication & Profile System: Architecture Plan (Day 2, step 1)

> Status: **plan** for the next implementation pass. Grounded in a full inspection of the
> existing codebase (backend foundation from PRs #2/#3/#4 + the client SPA). Nothing here
> rebuilds existing systems; every section reuses what already exists. No secrets were
> read or displayed; external-service configuration names are documented, values never.

---

## 0. What already exists (reused as-is)

| Asset | Location | Role in this plan |
| --- | --- | --- |
| 42-table schema with `users`, `profiles`, `roles`, `teacherProfiles`, `privacySettings`, `auditLogs`, `consents` | `convex/schema.ts` | **Unchanged.** Auth attaches to it, it is not rebuilt |
| Fail-closed guards: `requireUser`, `requireRole`, `requireOwner`, `requireSelfOrStaff`, `canViewProfile`, `roleAtLeast` | `convex/security.ts` | Every auth/profile function composes these; they become live once a session exists |
| PII sanitizers: `publicProfileOf`, `publicPostOf`, `publicCommentOf`, `PublicProfileDTO` | `convex/validators.ts` | Profile reads project **only** through these — email/DOB/verification docs can never leak |
| Boundary validators (`vHandle`, `vDob`, `vEnum`, `vObject` rejecting unknown keys) | `convex/validators.ts` | Signup/profile-update inputs validate here before touching the DB |
| Append-only audit log + `appendAudit` helper | `convex/auditInternals.ts`, `auditLogs` table | Every auth event (signup, login, logout, reset, verification, teacher approval) appends `auth_event` / `teacher_verification` rows |
| Wire-function pattern: pure decision core + thin `queryGeneric`/`mutationGeneric` wrapper | `convex/social.ts` | `convex/auth.ts` and `convex/profiles.ts` follow the identical pattern |
| Convex migration path (`bun convex dev --once` typed schema push) | repo standard | Schema deltas ship additively |
| Client: `StoreProvider` (toast host, i18n `t()`), `GovernanceProvider` (`ageBand`, youth defaults), `AppShell`, `Avatar`/`Page`/`Bar` UI kit, EN/SQ dictionaries, hash routes `/profile`, `/user/:userId`, `/settings` | `src/` | Auth screens render inside the existing shell; providers stay; no duplicate state systems |
| DOB data-minimization precedent (`persistableState` strips DOB; only `ageBand` persists) | `src/state/governance.tsx` | The server DOB column follows the same rule: written once, never projected, used only for age assurance |

**External services chosen (config names only, no values read):**
- **Convex Auth** (`@convex-dev/auth`) — first-party auth for the existing Convex backend. Avoids a second identity provider (no duplicate auth system), keeps sessions server-side, and its JWT identity plugs straight into the existing `ctx.auth.getUserIdentity()` guards. Keys: none beyond the deployment's own; config names: `CONVEX_DEPLOYMENT`, `CONVEX_SITE_URL`, `VITE_CONVEX_URL` (public browser URL).
- **Resend** — transactional email only (verification, reset, security alerts). The API key lives **only** in the Convex action environment (`RESEND_API_KEY`), never in the SPA. No marketing email; respects the existing `EmailPrefs` governance model.

---

## 1. Engine & session strategy

- **Convex Auth** with the **Email + password (credentials)** provider.
  - Passwords hashed with the library's default scheme (scrypt via OS randomness) — never stored in plain text, never logged.
  - Passwords are compared only inside Convex mutation handlers; the client never sees hash material.
- **Sessions**: Convex Auth issues short-lived JWTs delivered to the browser as **httpOnly, Secure, SameSite=Lax cookies** on the Convex domain — not `localStorage`. This directly kills the XSS-token-theft class. Tokens refresh transparently by the client SDK.
- **Identity mapping**: the JWT `subject` becomes the existing `users._id` (Convex Auth's `jwt`/`createAccount` integration is configured so `getUserIdentity().subject` resolves to the same id the guards already use — `social.ts` wire functions continue working unmodified).
- **Fail-closed posture unchanged**: no session ⇒ `requireUser` throws ⇒ deny. `convex.json`'s "open until auth lands" note can then tighten to deny-by-default for sensitive groups once flows are audited.

## 2. Database changes (additive only — schema extension, not replacement)

Existing tables **reused, not recreated**: `users`, `profiles`, `roles`, `teacherProfiles`, `privacySettings`, `auditLogs`, `consents`.

New tables (mirroring Convex Auth's requirements, adapted to DENSEN conventions — `createdAt`/`updatedAt`/status fields/indexes):

```
authAccounts        userId: id<users>, provider: "password", providerAccountId: string (email, unique-by-convention via index),
                    secretHash — NO. (Hash lives in Convex Auth's own authTables; authAccounts only maps provider identity → users row)
authSessions        userId, tokenHash (sha-256 of the session secret — raw tokens never stored), issuedAt, expiresAt,
                    revokedAt?: number, userAgentLabel, createdAt          // index: by_token_hash (unique lookup), by_user_time
verificationTokens  purpose: "email_verify" | "password_reset", targetUserId, tokenHash, expiresAt,
                    consumedAt?: number, createdAt                          // index: by_token_hash, by_user_purpose
loginAttempts       emailNormalized (no userId — pre-account), ip? (hashed), outcome: "success"|"bad_password"|"unknown_email"|"rate_limited",
                    createdAt                                               // index: by_email_time — brute-force lockout + enumeration defense
```

Delta to existing tables (all optional fields → zero backfill required):

```
users       + emailVerifiedAt?: number            // email verification state (null = unverified)
            + passwordUpdatedAt?: number          // change-password audit + "sign out other sessions" decision
profiles    + onboardingStep?: number             // resumable registration (step 0..n), undefined = completed
```

Teacher flow uses the **existing** `teacherProfiles` table exactly as designed (`pending → verified | rejected | revoked`, `verifiedBy`, `verifiedAt`, private `verificationDocRefs`). Registration with the Teacher intent creates a `pending` row — nothing else changes about verification.

**Migration sequence**: additive `bun convex dev --once` push → smoke query on new tables → client wiring. No data backfill needed (fields optional); no existing table is altered destructively.

## 3. Convex function structure (`convex/auth.ts`, `convex/profiles.ts`, `convex/admin.ts`)

Pattern per module: **pure decision core (unit-tested) + thin wire function** using the existing guards and sanitizers.

### `convex/auth.ts`
| Function | Kind | Guards & behavior |
| --- | --- | --- |
| `signUp` | mutation | Boundary-validates via `vObject` (unknown keys rejected): firstName, `vHandle` (unique check via `profiles.handle` index — race-safe read-before-write), normalized email (uniqueness via `users.email` index, check-emptiness-first per schema comment), password (min length, breach-pattern deny-list at boundary), `vDob`. Derives `ageBand` server-side from DOB (client value never trusted), creates `users` + `profiles` + `privacySettings` (youth defaults from the **existing** `ageAwareDefaults` port) in **one transaction**; inserts `authAccounts`; appends `auth_event: signup`; returns only `{ ok, needsEmailVerification }` |
| `signIn` | mutation | Constant-shape responses (unknown email vs wrong password indistinguishable to caller); verify hash; check `users.status` (suspended/deleted deny); insert `authSessions` (store token **hash** only); log outcome row in `loginAttempts` (incl. `rate_limited`); append `auth_event: login_failed/succeeded` (no email in summary) |
| `signOut` | mutation | Requires a valid session; sets `revokedAt` (server-side revocation, not client-only); appends `auth_event: logout` |
| `requestPasswordReset` | mutation | Always returns ok (enumeration-safe); if the account exists, mints `verificationTokens(purpose:"password_reset")`, stores hash, queues email via the email action; append `auth_event: password_reset_requested` |
| `resetPassword` | mutation | Token lookup by **hash**, expiry + single-consume (transactional `consumedAt` set on use), new password validated, all sessions revoked, `passwordUpdatedAt` set, `auth_event: password_reset_completed` |
| `changePassword` | mutation | `requireUser` + **re-verify current password**; sets `passwordUpdatedAt`; optionally revokes other sessions; `auth_event: password_changed` |
| `verifyEmail` | mutation | Token by hash, single-consume, sets `users.emailVerifiedAt`; `auth_event: email_verified` |
| `resendVerification` | mutation | Session-or-email bound, rate-limited via `loginAttempts` pattern |
| `requestAccountRecovery` | mutation | Locked account / lost-email path: records request to `auditLogs` for staff follow-up (no automated account takeover decision); never reveals whether the email exists |
| `getSession` | query | Returns the minimal non-PII viewer shape: `{ userId, role, userStatus, handle, displayName, avatarUrl, emailVerified, isMinor }` — powers the client `AuthProvider` |

### `convex/profiles.ts`
| Function | Kind | Guards & behavior |
| --- | --- | --- |
| `getMyProfile` | query | `requireUser`; self-view may include `email` + `emailVerifiedAt` (own data) but **never** `dob` raw value — age band only |
| `updateProfile` | mutation | `requireUser`; `vObject` mass-assignment-proof (handle/bio/styles/level/city only); handle uniqueness; `showCity` honored via existing `privacySettings` |
| `getPublicProfile` | query | **Already exists** (`social.ts`) — reused untouched; visibility via `canViewProfile`, projects via `publicProfileOf` |
| `listMyVideos/Practice/Achievements/Classes/Choreographies` | queries | Owner-scoped reads using existing tables (`videos`, `practiceSessions`, `userAchievements`, `enrollments`) with `requireOwner`/self-or-staff |
| `setTeacherIntent` | mutation | `requireUser` + age-gated (minors: require guardian flow from existing governance defaults before `teacherProfiles.pending` row); writes `teacherProfiles{status:"pending"}` + `auth_event/teacher_verification: requested` |

### `convex/admin.ts` (teacher verification & safety console)
| Function | Kind | Guards |
| --- | --- | --- |
| `teacherQueue` | query | `requireRole(,"moderator")` — lists `teacherProfiles.status="pending"` |
| `reviewTeacher` | mutation | `requireRole(,"moderator")`; approves/rejects/revokes; on verify: `users.role = "teacher"`, `roles` row appended (existing table), `auth_event: teacher_verified`; rejected/revoked reverts role to `user` |
| `moderationQueueCounts` | query | **Already exists** — untouched |

## 4. Client integration points

1. **`ConvexProvider`** wraps the SPA in `src/main.tsx` (public `VITE_CONVEX_URL` only — it is a browser URL by design, not a secret).
2. **`ConvexAuthProvider`** (`@convex-dev/auth/react`) inside it — session state, `useAuthActions()` for sign-in/up/out, token transport via cookies.
3. **New `AuthProvider` context** (`src/state/auth.tsx`) bridging Convex Auth to the existing UI: subscribes to `getSession`, exposes `{ user, role, isMinor, loading }`, and **keeps the existing providers intact** — `StoreProvider`/`GovernanceProvider` render as today; `onboarded` logic moves from "always mock" to "completed server profile OR guest preview".
4. **Routes** (hash router, consistent with existing): `/auth` (sign in / sign up tabs), `/auth/forgot`, `/auth/reset`, `/auth/verify`, `/auth/change` — all rendered inside `AppShell` with the existing `Page`, `Bar`, `Avatar`, button/chip classes → the premium dark + gold identity and mobile-first layout carry over automatically. Registration collects **firstName, username (handle), email, password, DOB** and the **Dancer / Teacher intent** selector; DOB carries the existing "locked after sign-up" notice and the guardian step where `ageAwareDefaults` requires it.
5. **Route protection**: `RequireAuth` wrapper (redirects guests to `/auth` preserving `returnTo`); `RequireRole` for `/admin` + teacher studio. The existing `/profile` and `/user/:userId` pages switch their data source to `getPublicProfile`/`getMyProfile` with the **same visual output** — profile tabs (VIDEOS / PRACTICE / CLASSES / ACHIEVEMENTS, plus COMBOS / CHOREOGRAPHIES / COURSES for teachers) read the new owner-scoped queries; empty states render from real data absence, not placeholders.
6. **i18n**: every new string enters `src/i18n.ts` EN + SQ (the parity test enforces this).
7. **DO NOT touch**: `StoreProvider`'s social/sync logic, governance consent records, safety scanners, existing pages' visual behavior. Auth is additive.

## 5. Red-team attack-surface mitigations (security by design)

| Surface | Design-time mitigation |
| --- | --- |
| **1. Secrets & credentials** | Password hashes & session secrets never leave Convex handlers. Email API key only in action env (`RESEND_API_KEY`); the SPA uses only the public `VITE_CONVEX_URL`. No secrets in source (repo verified clean, history included). No secret-bearing file is added. |
| **2. Database** | Convex ≠ Supabase — the RLS analogue is the function-layer guard: every read/write composes `requireUser`/`requireRole`/`requireOwner`. Public reads project **only** through `publicProfileOf`/`publicPostOf` (email/DOB/verification docs structurally unrepresentable in responses). `loginAttempts`/`verificationTokens` rows are never exposed by any query. Index-backed uniqueness checks are read-before-write inside the same transaction. |
| **3. Auth & authorization** | Fail-closed is the existing rule and stays: no session → deny. Server-side sessions with **revocation** (`revokedAt`), password change revokes other sessions, token hashes stored (not raw). Admin functions gate on `requireRole(, "moderator"/"admin")` — role comes from the users row, never from args. Constant-shape auth errors block user enumeration. `loginAttempts` per-email lockout + rate limits on `signIn`/`requestPasswordReset`/`resendVerification`. CORS: no custom server; cookies are SameSite=Lax, Secure. |
| **4. LLM / prompt injection** | No LLM features exist or are added by this plan. Future-proofing rule stays: user text is data, never concatenated into instructions; any model call would route through the boundary validators and server-side authorization (documented in SECURITY-AUDIT.md). |
| **5. Webhooks / external calls** | Only outbound call added: the Resend action. Its secret never crosses the client; failures fail soft (auth flow proceeds; email retried/queued) and are logged without payloads. The future payments webhook rule (raw-body HMAC, timestamp tolerance, `providerRef` idempotency — already documented) is unaffected. |
| **6. Dependency / supply chain** | Two new packages only: `@convex-dev/auth` (first-party Convex publisher) and `resend` (used only in the Convex action, never bundled into the SPA). Versions pinned; lockfile updated; no postinstall scripts introduced; dev-only tooling untouched. |
| **7. Logging & exposure** | Audit summaries contain **no email, no DOB, no IP, no token material** — event type + subject id only. No `console.*` of auth data anywhere (repo currently has zero console logging — preserved). Error responses are constant-shape; stack traces never reach the client. CSP already present (script-src 'self') and will be extended with `connect-src` entries for the Convex deployment origin if needed. |

## 6. Profile visibility & age-aware enforcement

- **Public vs private profile**: the existing `profiles.isPrivate` + `privacySettings.privateAccount` + tested `canViewProfile` core are the single enforcement point — guests see public profiles only; private requires self/follower/staff. New profile queries compose the same core (no parallel visibility logic).
- **Age-aware restrictions**: signup derives `ageBand` server-side from DOB (the `ageBand()` port already unit-tested in `src/data/governance`), writes `users.isMinor`, and applies the youth defaults from the existing `ageAwareDefaults` engine to `privacySettings` (private account, restricted discoverability, restricted messaging). Minors' profiles are **private by default**, `showCity` defaults false, and `setTeacherIntent` is blocked for minors pending guardian authorization. Minors cannot be made publicly discoverable through any new query — projection + visibility rules guarantee it.
- **Profile fields**: the public field set is exactly `PublicProfileDTO` (handle, display name, bio, avatar, styles, level, approximate city gated by `showCity`, teacher status). Email/DOB/verification docs/private settings are absent from the DTO type itself — they cannot be serialized by public queries. Own-data reads (`getMyProfile`) additionally surface only the user's own email + verification state.
- **Teacher verification**: `teacherProfiles` keeps its state machine (`pending → verified | rejected | revoked`), staff review via `requireRole("moderator")`, decision + reviewer + timestamp appended to the immutable audit log; the SPA shows the verified badge only when `teacherStatus === "verified"` (evidence-backed, as implemented in the profile today). Nobody self-claims the teacher role.

## 7. Testing & validation plan (implementation pass)

- Pure-core unit tests for every auth decision (signup validation, lockout thresholds, token single-consume, enumeration-safe responses, age-band derivation, role grant rules) added to the existing suite — target **140+ tests**.
- `bun convex dev --once` schema push must stay green; `bun tsc -b --noEmit` clean; `bun run build` succeeds.
- Flow checks: signup → verify → sign-in → change password → reset → sign-out, plus deny paths (unauthenticated profile write, minor teacher intent, suspended login, wrong-role admin call).
- Existing 134-test suite + all pages must remain untouched and green (no duplicate systems, no deleted functionality).

## 8. What this plan deliberately does NOT do

- No OAuth/social login (not requested; Convex Auth can add it later without schema change).
- No MFA (future step; `authSessions` schema leaves room).
- No automated account-recovery decisions (recovery requests are logged for staff — deliberate anti-takeover stance).
- No changes to payments, media, or moderation behavior.
