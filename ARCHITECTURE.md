# DENSEN — Technical Architecture

> Status: foundation release. This document describes the system as it exists in the
> repository today — including what is enforced, what is scaffolded, and what is
> planned. Nothing here is aspirational; flagged items say so.

---

## 1. System overview

```
┌────────────────────────────────────────────────────────────┐
│  Client SPA (Vite + React 18 + TypeScript)                 │
│  - Hash routing, EN/SQ i18n, custom CSS design system      │
│  - CSP + focus-visible a11y baseline                       │
│  - localStorage persistence (prototype state)              │
└───────────────────────────┬────────────────────────────────┘
                            │  (wiring lands with auth — §9)
┌───────────────────────────▼────────────────────────────────┐
│  Convex backend (convex/)                                  │
│  schema.ts            36 tables, typed unions, 30+ indexes │
│  security.ts          fail-closed authz core               │
│  validators.ts        input validation + PII sanitizers    │
│  auditInternals.ts    append-only audit sink               │
│  social.ts            exemplar module (follow/profiles)    │
└────────────────────────────────────────────────────────────┘
```

- **Client**: `src/` — unchanged product surface (feed, learn, challenges, governance
  flows). Persistence is `localStorage` (`densen_state_v1`, `densen_governance_v1`).
- **Backend**: `convex/` — the scalable foundation: schema + security layer +
  validation/sanitization + an exemplar module. It is *typed and pushed to the local
  Convex deployment*, but **not yet called by the SPA** (no auth provider wired yet;
  see §9).

## 2. Database structure

Single source of truth: `convex/schema.ts`. Schema pushed successfully
(`bun convex dev --once` → "Convex functions ready", generated DataModel is typed from
the schema).

### Modules and tables

| Module | Tables |
| --- | --- |
| identity | `users`, `profiles`, `roles`, `teacherProfiles` |
| learning | `classes`, `moves`, `combos`, `choreographies`, `courses`, `lessons`, `practiceSessions` |
| content | `videos`, `posts`, `comments`, `reactions`, `savedContent`, `copyrightClaims`, `copyrightDisputes`, `moderationActions` |
| social | `follows`, `conversations`, `messages`, `notifications` |
| engagement | `challenges`, `challengeParticipants`, `xpTransactions`, `danceCredits`, `achievements`, `userAchievements`, `streaks` |
| commercial | `purchases`, `subscriptions`, `teacherPayouts` |
| governance | `reports`, `consents`, `privacySettings`, `devicePermissions`, `legalDocuments`, `auditLogs` |

### Conventions

- `createdAt`/`updatedAt` epoch-millis on every mutable entity; ownership field
  (`ownerId`/`userId`/natural owner) on every user-created row.
- Status fields are **closed unions** (`v.union(v.literal(...))`), never free strings.
- Denormalized counters (`followerCount`, `likeCount`, …) are updated inside the same
  logical operation as the edge write (see `social.ts`).
- High-volume tables carry covering indexes:
  - `posts`: `by_user_status`, `by_status_created`, `by_hashtag`
  - `comments`: `by_post_status` (postId, status, createdAt)
  - `reactions`: `by_target`, `by_user_target` (toggle lookups)
  - `notifications`: `by_user_unread`, `by_user_recent`
  - `messages`: `by_conversation_time`, `by_sender` (contact-pattern analysis)
  - `reports`: `by_status_priority`, `by_target`, `by_reporter`
  - `follows`: `by_follower`, `by_followee`, `by_follower_followee` (uniqueness)
- PII lives in `users` (email, dob) and never in public tables. Public shapes are
  produced only by sanitizers (§4).

## 3. User roles

Hierarchy: `user (1) < teacher (2) < moderator (3) < admin (4)` — `convex/security.ts`.

| Role | Grants |
| --- | --- |
| `user` | dancer; own-data CRUD |
| `teacher` | publish classes/courses/choreographies (verification required: `teacherProfiles.status`) |
| `moderator` | moderation queues, hidden-content reads, user restrictions |
| `admin` | business/roles/legal administration; **no implicit superuser** — every grant is an explicit `roleAtLeast` call |

Suspended/deleted accounts: `requireUser`/`requireRole` deny role privileges outright
(fail closed). The governance UI's staff-role selector remains a prototype-only
simulation until real auth lands.

## 4. Security model (enforced patterns)

1. **Fail closed** — no identity/role ⇒ deny. `requireUser(null)` throws.
2. **Identity from session, never args** — wire functions resolve the caller from
   `ctx.auth.getUserIdentity()`; client-supplied ids are never trusted.
3. **PII-stripping projections** — `validators.ts` ships `publicProfileOf`,
   `publicPostOf`, `publicCommentOf`; public queries may return only these shapes
   (no email/dob/status internals; `city` gated by `showCity`, hidden by default).
4. **Input validation at boundaries** — `vObject` rejects unknown fields
   (mass-assignment protection), closed enums, length caps, handle/hashtag/dob formats.
5. **Write-uniqueness** — e.g. follow toggle uses read-before-write on the
   `by_follower_followee` pair; the pure decision core is unit-tested.
6. **Append-only audit log** — `auditInternals.ts` has no update/delete path;
   security-relevant events (follow/unfollow, moderation, age verification, …) append
   rows with actor + role + timestamp.
7. **Visibility rules** — `canViewProfile` enforces private-account/follower/staff
   gates server-side; suspended/deleted targets are invisible.
8. **Not yet enforced (honest list)** — real auth sessions, rate limiting, encryption
   at rest, password policy (no passwords exist yet), signed media URLs. See §9.

## 5. Authentication strategy

**Target**: Convex Auth (or Auth0 via `convex/react-auth0`) issuing a JWT whose
`subject` maps to a `users` row (`users.email` index; unique-by-convention at the
boundary). Age is assured at registration (`dob` → `ageBand` → safety defaults); DOB
is stored once, never displayed, never projected.

**Today**: the SPA runs without auth; the backend guards exist and are tested, and
wire functions already resolve callers from `ctx.auth` — they return deny paths for
anonymous sessions. Wiring the provider (§9 step 1) activates them without changes.

## 6. Storage strategy

`videos.storageRef` / `lessons.videoRef` / `audioRef` are **opaque object-storage
references** — never public URLs. When media storage lands (Convex storage or S3/R2),
reads mint short-lived signed URLs inside server functions; the browser never receives
bucket credentials. Thumbnails likewise. Upload flow will be: client requests a
signed upload URL from an authenticated mutation → direct-to-bucket upload →
moderation scan (`moderationStatus: pending`) before publish.

## 7. API structure

Each feature domain becomes one module in `convex/` exporting queries + mutations.
`convex/social.ts` is the exemplar: pure decision cores (unit-testable) + thin wire
functions (`queryGeneric`/`mutationGeneric` from `convex/server`) that:
resolve caller → validate args with `validators.ts` → apply the pure core → write →
sanitize the return value.

Planned modules (no duplicates; each maps to schema tables):
`identity.ts`, `content.ts` (posts/comments/reactions), `messages.ts` (+ gating from
`src/data/safety.ts` logic), `learning.ts`, `engagement.ts` (XP/credits/achievements
ledger writes), `commercial.ts` (provider-side money, webhook-driven), `governance.ts`
(reports/consents/deletion), `admin.ts` (staff-only).

**Codegen note**: `_generated/server` bindings require a linked deployment; modules
use `convex/server` builders directly so the backend compiles and typechecks without
one. Generated types (`convex/_generated`) are already schema-typed and used for
`Id`/`Doc` types as they become relevant.

## 8. Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `PORT` | preview/host | server bind port (dev script: `${PORT:-5173}`) |
| `VITE_CONVEX_URL` | SPA (public) | Convex deployment URL for the client |
| `CONVEX_DEPLOY_KEY` | CI only | `npx convex deploy` in pipelines — never in client code |

No secrets today: the repo contains **zero** `process.env`/`import.meta.env` reads,
no `.env` files tracked, and a full git-history scan found no leaked credentials.
Money flows will hold provider secrets server-side only (`process.env` inside Convex
actions, or the payment provider's dashboard config).

## 9. Future module structure (migration path)

1. Wire `ConvexClientProvider` + auth provider in `src/main.tsx` → replace the two
   `localStorage` stores incrementally (reactive queries per page, starting with feed
   + follow states).
2. Split `src/data/store.ts` mock data into seed mutations (`convex/seed.ts`) so the
   prototype content populates real tables.
3. Port the tested logic from `src/data/safety.ts` / `src/data/governance.ts` into
   server modules (the pure functions port 1:1; scanners run server-side before
   writes).
4. Add modules in the order of §7; keep every public read behind sanitizers.
5. Introduce payments (provider webhooks → `purchases`/`subscriptions` mirrored rows),
   media storage with signed URLs, and notifications fan-out.
6. Rate limiting + abuse heuristics on public mutations (per-caller counters).

## 10. Verification

- `bun run test` → **125/125** (foundation suite: `src/__tests__/backend.test.ts`
  covers guards, visibility, validation, sanitizers, follow logic, audit immutability).
- `bun tsc -b --noEmit` → clean (backend included via `tsconfig.json`).
- `bun convex dev --once` → schema push verified against the local deployment.
