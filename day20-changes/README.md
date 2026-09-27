# DENSEN Day 20 — Downloadable Changes Package

Generated: 2026-09-27 · Commit `e700f16` · PR #29 (merged to main @ `6e2f1b1`)
Repo: eniba77a/Densen-app

## What's in this folder

| File | What it is |
|---|---|
| `AUDIT-DAY20.md` | Full 36-area audit report (30 PASS / 6 WARNING / 0 ACTION REQUIRED) |
| `convex/content.ts` | **Fix 1:** minor posts can never auto-publish (`decidePost` callerIsMinor cap) |
| `convex/discoverWire.ts` | **Fix 2:** hashtag aggregation only from PUBLISHED posts (leak closed) |
| `convex/paymentsWire.ts` | **Fix 3:** malformed IDs deny cleanly (no more 500s in the money path, `safeGet`) |
| `convex/practiceWire.ts` | **Fix 4:** `saveItem` returns `itemId` on fresh save |
| `src/state/store.tsx` | **Fix 5:** `<html lang>` follows the EN/SQ toggle (WCAG 3.1.1) |
| `src/__tests__/backend.test.ts` | 5 new unit tests pinning the minor-publish cap |
| `scripts/audit-journeys.cjs` | NEW: Journeys 1–5 live E2E (49 checks) |
| `scripts/audit-probe.cjs` | NEW: anonymous authz probe (15/15 deny) |
| `DAY20-FULL-PATCH.diff` | The complete git diff (Day 19 → Day 20) — apply with `git apply` |

## Where these changes also live

- **GitHub (already merged):** https://github.com/eniba77a/Densen-app/pull/29
  - commit: https://github.com/eniba77a/Densen-app/commit/e700f16
- **This project's workspace:** the files above in `day20-changes/`, mirroring the repo layout.

## How to apply elsewhere (if cloning the repo fresh)

```sh
git clone https://github.com/eniba77a/Densen-app.git
cd Densen-app
git checkout main        # Day 20 is already merged here
```

Or apply just the patch onto an older base:

```sh
git apply DAY20-FULL-PATCH.diff
```

## Verification results (all run against the live backend)

- `bun tsc -b --noEmit` → GREEN
- `bun vitest run` → 554/554 (24 files, +5 new)
- `bun convex dev --once` → functions ready
- E2E day15/16/17/19 → 128/128
- `node scripts/audit-probe.cjs` → 15/15 denied anonymously
- `node scripts/audit-journeys.cjs` → 49/49 journey checks
- Preview smoke → 7/7 (CSP present)
