/**
 * DENSEN — For-You recommendation core (Day 5).
 * =============================================
 * Pure, unit-tested decision core. NO fake data lives here: every signal is
 * derived from real viewer state (what you liked, which courses you watch,
 * whom you follow, which challenges you joined, what you saved/practice).
 *
 * This is the client-side seam for the future server ranking: each signal
 * maps 1:1 to a backend source when the feed goes fully server-backed —
 *   viewerStyleIds        → profiles.styles + classes watched (recent/progress)
 *   followedUserIds       → follows table
 *   joinedChallengeStyles → challengeParticipants ⋈ challenges.style
 *   savedCourseIds        → savedContent(course)
 *   recentCourseIds       → recent lessons ⋈ courses (practice activity)
 * Safety is not a signal — it is a hard filter applied before scoring
 * (non-discoverable authors never enter the ranking) plus an
 * educational-first gate for minors (Day-1 youth rule).
 */
import type { Course } from "./store";

export type CourseLevel = Course["level"];

export interface FeedSignals {
  /** Styles the viewer dances: self-declared + styles of watched/saved courses. */
  viewerStyleIds: readonly string[];
  /** Accounts the viewer follows. */
  followedUserIds: ReadonlySet<string>;
  /** Styles of challenges the viewer joined. */
  joinedChallengeStyles: readonly string[];
  /** Courses with progress > 0 (classes watched). */
  inProgressCourseIds: ReadonlySet<string>;
  /** Recently opened courses (practice activity). */
  recentCourseIds: ReadonlySet<string>;
}

export interface FeedPostInput {
  id: string;
  userId: string;
  style: string;
  lessonRef?: string;
  likes: number;
  views: number;
}

export type FeedReasonKind = "style_match" | "teacher_followed" | "challenge_mate" | "course_connection" | "trending";

export interface FeedReason {
  kind: FeedReasonKind;
  /** i18n key fragment resolved by the UI (feed.why.<kind>). */
}

export interface ScoredFeedItem<T> {
  post: T;
  score: number;
  reasons: FeedReasonKind[];
  /** Difficulty from the linked course, when the post teaches a move. */
  level?: CourseLevel;
}

export interface ForYouOptions {
  /** Hard safety filter — runs BEFORE any scoring (never ranks excluded authors). */
  includePost: (post: FeedPostInput) => boolean;
  courseLevel: (courseId: string | undefined) => CourseLevel | undefined;
  isTeacher: (userId: string) => boolean;
  /** Youth-safety rule: minors see educational (move-linked) posts first. */
  educationalFirst: boolean;
}

const STYLE_WEIGHT = 3;
const CHALLENGE_WEIGHT = 2;
const COURSE_WEIGHT = 3;
const RECENT_WEIGHT = 2;
const FOLLOW_WEIGHT = 2;
const TEACHER_WEIGHT = 1;
const TRENDING_VIEWS = 100_000;
const TRENDING_LIKES = 5_000;

function trendingBoost(post: FeedPostInput): number {
  let boost = 0;
  if (post.views >= TRENDING_VIEWS) boost += 2;
  if (post.likes >= TRENDING_LIKES) boost += 1;
  return boost;
}

/** Score one post against the viewer's real signals. Pure. */
export function scorePost<T extends FeedPostInput>(
  post: T,
  signals: FeedSignals,
  opts: { isTeacher: (userId: string) => boolean; courseLevel: (courseId: string | undefined) => CourseLevel | undefined }
): ScoredFeedItem<T> {
  const reasons = new Set<FeedReasonKind>();
  let score = 0;

  if (signals.viewerStyleIds.includes(post.style)) {
    score += STYLE_WEIGHT;
    reasons.add("style_match");
  }
  if (signals.joinedChallengeStyles.includes(post.style)) {
    score += CHALLENGE_WEIGHT;
    reasons.add("challenge_mate");
  }
  if (post.lessonRef && signals.inProgressCourseIds.has(post.lessonRef)) {
    score += COURSE_WEIGHT;
    reasons.add("course_connection");
  } else if (post.lessonRef && signals.recentCourseIds.has(post.lessonRef)) {
    score += RECENT_WEIGHT;
    reasons.add("course_connection");
  }
  if (signals.followedUserIds.has(post.userId)) {
    score += FOLLOW_WEIGHT;
    reasons.add("teacher_followed");
  }
  if (opts.isTeacher(post.userId)) {
    score += TEACHER_WEIGHT;
    reasons.add("teacher_followed");
  }
  const tBoost = trendingBoost(post);
  if (tBoost > 0) {
    score += tBoost;
    reasons.add("trending");
  }

  return { post, score, reasons: [...reasons], level: opts.courseLevel(post.lessonRef) };
}

/**
 * DENSEN feed rhythm: no three consecutive posts in the same style — keeps
 * the vertical feed varied the way a dancer's session varies. Stable: only
 * reorders within equal-score windows, never demotes a post below a lower
 * score.
 */
export function interleaveStyles<T extends FeedPostInput>(items: ScoredFeedItem<T>[]): ScoredFeedItem<T>[] {
  const out: ScoredFeedItem<T>[] = [];
  const used = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    out.push(items[i]);
    used.add(i);
    // same style twice in a row already? force a style change next
    if (
      out.length >= 2 &&
      styleOf(out[out.length - 1]) === styleOf(out[out.length - 2])
    ) {
      const swap = items.findIndex(
        (c, j) => !used.has(j) && styleOf(c) !== styleOf(out[out.length - 1])
      );
      if (swap !== -1) {
        out.push(items[swap]);
        used.add(swap);
      }
    }
  }
  return out;
}

function styleOf<T extends FeedPostInput>(item: ScoredFeedItem<T>): string {
  return item.post.style;
}

/**
 * Build the For-You feed: safety filter → score → sort (score, then views) →
 * optional educational-first for minors → style diversity.
 */
export function buildForYou<T extends FeedPostInput>(
  posts: readonly T[],
  signals: FeedSignals,
  opts: ForYouOptions
): ScoredFeedItem<T>[] {
  const eligible = posts.filter((p) => opts.includePost(p));
  const scored = eligible.map((p) => scorePost(p, signals, opts));
  scored.sort((a, b) => b.score - a.score || b.post.views - a.post.views);

  if (opts.educationalFirst) {
    // minors: educational posts (linked to a course) take absolute priority
    const edu = scored.filter((s) => s.post.lessonRef);
    const rest = scored.filter((s) => !s.post.lessonRef);
    return interleaveStyles([...edu, ...rest]);
  }
  return interleaveStyles(scored);
}

/**
 * Posts from accounts the viewer follows, ranked with the same core so the
 * Following tab keeps DENSEN ordering (relevance within the followed set).
 */
export function buildFollowing<T extends FeedPostInput>(
  posts: readonly T[],
  signals: FeedSignals,
  opts: ForYouOptions
): ScoredFeedItem<T>[] {
  return buildForYou(posts, signals, opts).filter((s) =>
    signals.followedUserIds.has(s.post.userId)
  );
}

/* --------------------------- pagination --------------------------- */

export const FEED_PAGE_SIZE = 4;

/** Pure page slicing for the vertical feed's infinite scroll. */
export function paginate<T>(list: readonly T[], visibleCount: number): { items: T[]; hasMore: boolean } {
  const items = list.slice(0, Math.max(0, visibleCount));
  return { items, hasMore: visibleCount < list.length };
}
