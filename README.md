# Densen Academy

**Learn dance · Create · Share · Connect** — a social dance platform prototype for children, teens and dancers, inspired by STEEZY's education depth combined with a TikTok/Instagram-style community, wrapped in a premium charcoal-and-gold identity.

## Stack

- React 18 + TypeScript + Vite
- Custom CSS design system (no UI framework) — Sora/Inter, Densen gold `#e3b341` on charcoal `#0b0d10`
- React Router (hash routing for static hosting)
- Zero backend: everything runs on realistic mock data with `localStorage` persistence

## Run

```bash
bun install
bun run dev      # dev server on 0.0.0.0:5173
bun run build    # production build to dist/
```

## Bilingual

Full English 🇬🇧 / Albanian 🇦🇱 dictionaries (`src/i18n.ts`). Switch from **Profile → Settings → Language**; the choice persists.

## Feature map

| Area | Route |
| --- | --- |
| Home (hero, continue learning, class rails, categories) | `/` |
| Vertical video feed (For You / Following, likes, comments, saves, duets) | `/feed` |
| Discover (universal search + trending) | `/discover` |
| Create (post composer, formats, visibility, audio picker) | `/create` |
| Duet / collaboration studio | `/duet/:postId` |
| Choreography versions page | `/versions/:postId` |
| Learn (courses by style & level) | `/learn` |
| Course detail + lesson player (Watch / Learn / Practice / Complete) | `/course/:id`, `/lesson/:courseId/:lessonId` |
| Challenges (join, leaderboard, entries) | `/challenges`, `/challenge/:id` |
| Progress dashboard (XP, streak, goals, achievements) | `/progress` |
| Events, Live classes, Leaderboards | `/events`, `/live`, `/leaderboards` |
| Messages (1:1 + group chats, lesson sharing) | `/messages` |
| Notifications center | `/notifications` |
| Profiles (dancer / teacher / own) with tabs | `/user/:id`, `/profile` |
| Dance teams | `/teams`, `/team/:id` |
| Trending audio | `/audio` |
| Settings & Privacy (incl. minor protections, language) | `/settings` |
| Admin dashboard (stats, moderation queue, revenue) | `/admin` |

## Media

Placeholder photography from Unsplash and dance video clips from Pexels (all URLs verified reachable). Swap with real content by editing `src/data/media.ts`.

## Prototype scope

Deliberately excluded per product brief: payments, real authentication, video upload/storage, realtime messaging. All social actions (likes, follows, saves, joins, progress, XP) are real, interactive and persisted locally so the prototype feels alive.
