# DENSEN — Complete Work Download (Days 1–20)

Generated: 2026-09-27 · Repo is now **PUBLIC**: https://github.com/eniba77a/Densen-app
main @ `a3febc1` (Day 20 audit merged via PR #29 + final sweep via PR #30)

## What this folder is

A complete snapshot of the entire repository (163 files) exported straight from
git at the current `main` — **everything we've built in Days 1–20**, ready to
browse or drop into any machine.

## Download options (pick one)

1. **This folder** — `densen-work/` in the workspace file panel. Download files
   individually or the whole folder, depending on what your Freebuff client offers.
2. **GitHub ZIP (no account needed, repo is public):**
   https://github.com/eniba77a/Densen-app/archive/refs/heads/main.zip
3. **Git clone:**
   ```sh
   git clone https://github.com/eniba77a/Densen-app.git
   cd Densen-app && bun install
   ```

## Where the highlights live

| Path | What it is |
|---|---|
| `AUDIT-DAY20.md` | Full 36-area Day 20 audit report (30 PASS / 6 WARNING / 0 ACTION REQUIRED) |
| `day20-changes/` | The Day 20 download package: fixed source files, both audit scripts, full git diff |
| `convex/` | The entire backend (53 modules): auth, privacy, child safety, video pipeline, payments (fail-loud), copyright (fail-loud), studio, arcade/XP/credits/streaks, moderation, admin, legal/consents/deletion |
| `src/` | The full SPA: landing, auth flow, feed, discover, learn, practice, arcade, studio, messages, privacy center, moderation center, admin verification — EN/SQ bilingual, dark + gold identity |
| `scripts/` | E2E suites (day15/16/17/19), journeys + probe audit scripts, verify.sh |
| `SECURITY-AUDIT.md` / `ARCHITECTURE.md` / `AUTH-PLAN.md` | Prior architecture + security documentation |

## Verified state at export

- `tsc` GREEN · vitest **554/554** · E2E **128/128** · probe **15/15** · journeys **49/49** · preview smoke **7/7**
- No secrets in the repo (env files are gitignored and were never committed)
- Payments/copyright intentionally fail loud when providers are unconfigured — config requirements documented, never faked

## Run it locally

```sh
bun install
bun dev          # SPA (Vite)
bun convex dev   # backend (needs a Convex deployment; .env.local: CONVEX_DEPLOYMENT, VITE_CONVEX_URL, VITE_CONVEX_SITE_URL)
bun test         # 554 unit tests
sh scripts/verify.sh   # SPA smoke
```
