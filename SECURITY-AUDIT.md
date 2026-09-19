# DENSEN — Security & Privacy Audit (red-team pass)

> Scope: full repository walk — secrets, dependencies, history, XSS/PII/logging
> surfaces, persistence, and the new backend foundation. Method and severities per
> the engagement brief. Evidence commands are noted inline where relevant.

## Environment facts that shape this report

- The application is a **static Vite SPA** with **no server-side API surface yet**
  (no endpoints, no webhooks, no LLM/MCP integrations, no CORS-bearing servers).
  Several brief attack surfaces (Supabase RLS, webhook signature replay, LLM prompt
  injection, CORS-on-mutating-endpoints) have **no present target** — they are
  mapped to their future Convex/payment-provider counterparts instead of being
  marked "pass" (nothing exists to pass).
- **Secrets**: zero `process.env`/`import.meta.env` reads in source; no `.env*`,
  `*.pem`, `*.key`, credentials or service-account files tracked
  (`git ls-files | grep -iE '\.env|\.pem|\.key|credential|service-account'` → 0);
  full-history scan (`git log --all --full-history -p`) → 0 secret-pattern hits.
- **Dependencies**: no postinstall scripts; no typosquat candidates in `bun.lock`
  (all packages are known: react, react-dom, react-router-dom, vite, vitest,
  typescript, convex). Convex is pinned `^1.19.0` (installed 1.46.0).

## Findings

| Severity | File/Line | Vulnerability | Exploit scenario (1-2 sentences) | Fix (concrete code change) |
| --- | --- | --- | --- | --- |
| High | `src/state/governance.tsx` (before fix; now `persistableState`) | Full **date of birth** persisted to `localStorage` (`densen_governance_v1`), client-readable by any XSS or extension | Any injected script or malicious extension reads the child's exact DOB — a PII/child-privacy leak and a CSPA/App-Store review risk | **Fixed**: DOB is now session-only; the derived `ageBand` persists instead (`persistableState()` strips `dob` before `JSON.stringify`; regression test `DOB data-minimization` enforces it). Long-term: DOB goes to the `users.dob` server column only (schema already has it private, never projected) |
| Medium | `index.html` (before fix) | No Content-Security-Policy — any injected inline/remote script runs with full page + localStorage access | One compromised npm dependency or a future innerHTML slip exfiltrates the persisted profile/governance state | **Fixed**: CSP meta added (`script-src 'self'`, `connect-src 'self' https://*.convex.cloud`, `frame-ancestors 'none'`, `base-uri/form-action 'self'`). Note: meta-CSP cannot express `report-uri`; move to a header when hosting config allows |
| Medium | `convex/social.ts:81-113` (`getPublicProfile`) | Public query accepts a bare `userId` string and returns a profile without a visibility check (private accounts would leak through the generic builder's loose typing) | An attacker enumerates private dancer profiles by id — contradicting the private-account youth-safety guarantee | **Fixed**: query now resolves the viewer from `ctx.auth` (guest→`null`), calls the tested `canViewProfile` core, and returns `{visible:false}` for strangers; publish-gated post projection via `publicPostOf` (unpublished rows never project) |
| Medium | `convex.json` (before fix) | Functions were configured open (`allow: *` for queries/mutations) while auth is not yet wired — an "open by default" backend posture | Once client wiring lands, every mutation would be anonymously callable before guards are individually audited | **Fixed**: `actions` denied by default (`deny`, `allowed: []`); the config documents that queries/mutations stay open only until Convex Auth wiring (ARCHITECTURE.md §9 step 1) — every wire function already enforces `requireUser`/`requireRole` internally, so the config is defense-in-depth, not the gate |
| Low | `src/state/store.tsx:187`, `src/state/governance.tsx` | Broad `localStorage` persistence of user activity (likes, messages, settings) without versioned schema for future migration | Not directly exploitable; stale keys could resurrect cleared state after future migrations | Acceptable for prototype; the backend migration path (ARCHITECTURE.md §9) replaces this persistence entirely; keys are versioned (`v1`) |
| Low | `vite.config.ts` | Dev server binds `0.0.0.0` without host checks | On a shared network, a crafted Host header could target the dev server (Vite 5 has `server.allowedHosts` defaults; risk is dev-only) | Optional hardening: `server: { allowedHosts: ["localhost"] }` — left as-is because Freebuff's managed preview requires `0.0.0.0` binding |
| Info | `convex/schema.ts:users` | `users.email` index is unique-by-convention, not a DB-level unique constraint | A race in future account-creation code could mint two rows per subject | Use Convex Auth's built-in uniqueness or a dedicated singleton table for identity mapping when wiring auth (noted in ARCHITECTURE.md §5) |
| Info | whole repo | No XSS sinks: `grep -rn "dangerouslySetInnerHTML\|eval(\|new Function\|document.write\|\.innerHTML" src/` → 0; no `console.*` logging of user data → 0; no `target="_blank"` without `rel` → 0 | — | Clean; keep the CSP so it stays that way |

### Surfaces with no present target (verified absent, not "passed")

- **Supabase/RLS**: no Supabase; Convex schema + function-level guards instead.
  Every future table read must go through guard-checked queries (pattern established
  in `social.ts`).
- **Webhooks / payments**: none exist. When Stripe (or equivalent) lands: verify
  signatures with the **raw body**, enforce a timestamp-tolerance window, make
  `purchases.providerRef` the idempotency key (schema column already exists), and
  never log webhook payloads.
- **LLM / prompt injection**: no LLM features. If recommendations ever call a model,
  user content must be fenced as data (never concatenated into instructions) and any
  tool-calling must stay behind server-side authorization (the `validators.ts`
  boundary is the pattern).
- **CORS on mutating endpoints**: no custom server exists; Convex handles origin
  policy per its own defaults.
- **Secrets in git history**: scanned, zero hits (`git log --all --full-history -p | grep …` → 0).

## Top 3 things to fix today

1. **~~DOB in localStorage~~ — fixed this pass.** DOB is session-only; the derived
   age band persists (`persistableState`, regression-tested). Keep DOB out of
   client persistence permanently when auth lands (server column only).
2. **CSP — fixed this pass.** Meta-policy now blocks injected scripts; promote it to
   a real response header (plus `report-to`) at the hosting layer when available.
3. **Private-profile visibility on public queries — fixed this pass** (`getPublicProfile`
   is viewer-scoped). The remaining follow-through before launch: wire real auth so
   `toggleFollow`/`getPublicProfile` stop returning deny-for-everyone and the
   functions-only-open-until-auth posture in `convex.json` can tighten, and add
   server-side rate limiting on public mutations (ARCHITECTURE.md §9 step 6).
