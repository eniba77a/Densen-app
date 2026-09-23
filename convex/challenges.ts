/**
 * DENSEN — Challenges decision core (Day 11).
 * ===========================================
 * Pure rules for the DENSEN challenge lifecycle. No IO here — the wire
 * module (`challengesWire.ts`) applies these decisions inside Convex
 * transactions, so every rule is unit-testable without a database.
 *
 * User flow:  VIEW → JOIN → PRACTICE → SUBMIT → COMPLETE → RECEIVE REWARD
 *
 * Anti-abuse carried over from the Day 9/10 ledger rules:
 *   - XP/credits pay exactly once per (user, challenge) via the ledger
 *     idempotency probes (a completed challenge can never re-pay);
 *   - participants are counted from `challengeParticipants`, never from
 *     client-supplied numbers;
 *   - submissions must reference the caller's own published post — nobody
 *     can complete with someone else's video.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ---------------- lifecycle ---------------- */

export type ChallengePhase = "upcoming" | "active" | "ended";

/**
 * Derive the visible phase from the challenge row's time window.
 * `startsAt` optional → open immediately; `deadlineAt` optional → never ends.
 */
export function phaseOf(row: { startsAt?: number; deadlineAt?: number }, now: number): ChallengePhase {
  if (row.startsAt !== undefined && now < row.startsAt) return "upcoming";
  if (row.deadlineAt !== undefined && now > row.deadlineAt) return "ended";
  return "active";
}

/** Days remaining, rounded up, clamped at 0 for ended/undated rows. */
export function daysLeftOf(deadlineAt: number | undefined, now: number): number {
  if (deadlineAt === undefined) return 0;
  return Math.max(0, Math.ceil((deadlineAt - now) / 86_400_000));
}

/** Which list tabs (client-side) a challenge with this phase belongs to. */
export function tabOf(phase: ChallengePhase): "active" | "upcoming" | "ended" {
  return phase;
}

/* ---------------- join decision ---------------- */

export type JoinDecision =
  | { action: "join" }
  | { action: "deny"; error: "unauthenticated" | "not_found" | "not_published" | "not_active" | "already_joined" };

export interface JoinInput {
  signedIn: boolean;
  challenge?: { status: string; studioStatus?: string } | null;
  alreadyJoined: boolean;
  phase: ChallengePhase;
}

/**
 * Join rules: must be signed in, the challenge must be public (published /
 * studio-published), and the window must be open. Re-joining is a no-op
 * error — the participant row is the anti-double-count source of truth.
 */
export function decideJoin(input: JoinInput): JoinDecision {
  if (!input.signedIn) return { action: "deny", error: "unauthenticated" };
  const ch = input.challenge;
  if (!ch) return { action: "deny", error: "not_found" };
  const isPublic = ch.status === "published" || ch.studioStatus === "published";
  if (!isPublic) return { action: "deny", error: "not_published" };
  if (input.phase !== "active") return { action: "deny", error: "not_active" };
  if (input.alreadyJoined) return { action: "deny", error: "already_joined" };
  return { action: "join" };
}

/* ---------------- submit decision ---------------- */

export type SubmitDecision =
  | { action: "submit" }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "not_found"
        | "not_published"
        | "not_active"
        | "not_joined"
        | "post_not_found"
        | "post_not_own"
        | "post_not_published"
        | "already_submitted";
    };

export interface SubmitInput {
  signedIn: boolean;
  challenge?: { status: string; studioStatus?: string } | null;
  joined: boolean;
  phase: ChallengePhase;
  /** The referenced post row (undefined = missing). */
  post?: { userId: string; status: string } | null;
  /** Caller's user id ("" when signed out). */
  callerUserId: string;
  alreadySubmitted: boolean;
}

/**
 * Submission rules: the caller must have joined, must own the referenced
 * post, and the post must be published (cleared safety). One submission per
 * (challenge, user) — a duplicate is an error, not a silent overwrite.
 */
export function decideSubmit(input: SubmitInput): SubmitDecision {
  if (!input.signedIn) return { action: "deny", error: "unauthenticated" };
  const ch = input.challenge;
  if (!ch) return { action: "deny", error: "not_found" };
  const isPublic = ch.status === "published" || ch.studioStatus === "published";
  if (!isPublic) return { action: "deny", error: "not_published" };
  if (input.phase !== "active") return { action: "deny", error: "not_active" };
  if (!input.joined) return { action: "deny", error: "not_joined" };
  if (input.alreadySubmitted) return { action: "deny", error: "already_submitted" };
  if (!input.post) return { action: "deny", error: "post_not_found" };
  if (input.post.userId !== input.callerUserId) return { action: "deny", error: "post_not_own" };
  if (input.post.status !== "published") return { action: "deny", error: "post_not_published" };
  return { action: "submit" };
}

/* ---------------- complete decision ---------------- */

export type CompleteDecision =
  | {
      action: "complete";
      xp: number;
      credits: number;
      badgeCode?: string;
    }
  | {
      action: "deny";
      error:
        | "unauthenticated"
        | "not_found"
        | "not_published"
        | "not_joined"
        | "no_cleared_submission"
        | "not_ended"
        | "already_completed";
    };

export interface CompleteInput {
  signedIn: boolean;
  challenge?: { status: string; studioStatus?: string; reward?: { xp?: number; credits?: number; badgeCode?: string } } | null;
  joined: boolean;
  phase: ChallengePhase;
  /** The caller's submission row (undefined = none). */
  submission?: { status: string } | null;
  /** Ledger probe result: a paid `challenge_complete` XP row for this ref. */
  alreadyPaid: boolean;
}

/**
 * Completion rules: joined + a **cleared** submission (never a rejected or
 * pending one — safety always gates rewards) + the window closed (or an
 * explicitly ended challenge). Rewards come from the challenge's reward
 * definition with configurable fallbacks; the ledger makes them one-time.
 */
export function decideComplete(input: CompleteInput): CompleteDecision {
  if (!input.signedIn) return { action: "deny", error: "unauthenticated" };
  const ch = input.challenge;
  if (!ch) return { action: "deny", error: "not_found" };
  const isPublic = ch.status === "published" || ch.studioStatus === "published";
  if (!isPublic) return { action: "deny", error: "not_published" };
  if (!input.joined) return { action: "deny", error: "not_joined" };
  if (input.alreadyPaid) return { action: "deny", error: "already_completed" };
  if (!input.submission || input.submission.status !== "cleared")
    return { action: "deny", error: "no_cleared_submission" };
  if (input.phase !== "ended") return { action: "deny", error: "not_ended" };
  const reward = ch.reward ?? {};
  return {
    action: "complete",
    xp: reward.xp ?? 250, // fallback mirrors XP_VALUES.challenge_complete
    credits: reward.credits ?? 2, // fallback mirrors CREDIT_VALUES.challenge_complete
    badgeCode: reward.badgeCode,
  };
}

/* ---------------- projection shape ---------------- */

/** Client-facing challenge view (ids as strings, phase resolved server-side). */
export interface ChallengeView {
  id: string;
  title: string;
  description: string;
  rules?: string;
  style?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  coverUrl?: string;
  teacherName?: string;
  startsAt?: number;
  deadlineAt?: number;
  phase: ChallengePhase;
  daysLeft: number;
  participantCount: number;
  submissionCount: number;
  hasJoined: boolean;
  hasSubmitted: boolean;
  mySubmissionStatus?: "pending" | "cleared" | "rejected";
  hasCompleted: boolean;
  reward: { xp?: number; credits?: number; badgeCode?: string };
  tutorialCourseId?: string;
}
