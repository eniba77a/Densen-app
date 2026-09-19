/**
 * DENSEN — Server-side youth-safety scanner core (Day 3).
 * ======================================================
 * Lockstep port of the client scanners (src/data/safety.ts) to the backend so
 * moderation decisions are enforced where they cannot be bypassed: on the write
 * path. The client copy stays the UX preview; the server copy is authoritative.
 *
 * Lockstep contract (verified by parity tests in src/__tests__/safetyCore.test.ts):
 *   - identical rule IDs, regexes, actions and escalation rules as the client
 *   - same inputs ⇒ same verdict, both sides
 *   - server returns rule IDS (stable codes); the client maps codes to i18n
 *     labels for display — no user-facing text lives in the backend.
 *
 * Changes to the client rules MUST be mirrored here in the same PR (and vice
 * versa) or the parity suite fails.
 */

/* ---------------- 44: comment safety scanner ---------------- */

export type CommentVerdict = "clean" | "hidden" | "blocked";

export interface CommentScanCore {
  verdict: CommentVerdict;
  /** Stable rule IDs (map to i18n labels client-side). */
  ruleIds: string[];
}

interface CommentRule {
  id: string;
  re: RegExp;
  action: CommentVerdict;
  /** Rules escalate to "blocked" when the target (post author) is a minor. */
  targetMinorEscalates?: boolean;
}

const COMMENT_RULES: CommentRule[] = [
  { id: "sexual", re: /\b(sexy|nudes?|hot body|sexual)\b/i, action: "blocked" },
  { id: "solicitation", re: /\b(send|dm) (me )?(pics?|photos?|videos?)\b/i, action: "blocked" },
  { id: "selfharm", re: /\b(kill yourself|kys|hurt yourself|end it)\b/i, action: "blocked" },
  { id: "hate", re: /\b(hate|disgusting|worthless)\b/i, action: "hidden", targetMinorEscalates: true },
  { id: "insult", re: /\b(stupid|idiot|ugly|loser)\b/i, action: "hidden", targetMinorEscalates: true },
  { id: "threat", re: /\b(threat|watch your back|find you)\b/i, action: "blocked" },
  { id: "doxx", re: /\b(lives at|home address|goes to .* school|school name)\b/i, action: "hidden" },
  { id: "contact", re: /\b(whatsapp|snap(chat)?|telegram|my number)\b/i, action: "hidden", targetMinorEscalates: true },
  { id: "scam", re: /\b(free followers|buy likes|click .*(link|here)|crypto)\b/i, action: "hidden" },
];

export function scanCommentCore(text: string, targetIsMinor = false): CommentScanCore {
  const ruleIds: string[] = [];
  let verdict: CommentVerdict = "clean";
  for (const r of COMMENT_RULES) {
    if (!r.re.test(text)) continue;
    const action = targetIsMinor && r.targetMinorEscalates ? ("blocked" as const) : r.action;
    ruleIds.push(r.id);
    if (action === "blocked") verdict = "blocked";
    else if (action === "hidden" && verdict !== "blocked") verdict = "hidden";
  }
  return { verdict, ruleIds };
}

/* ---------------- 45: grooming / exploitation scanner ---------------- */

export type GroomingSeverity = "none" | "review" | "critical";

export interface GroomingScanCore {
  severity: GroomingSeverity;
  ruleIds: string[];
}

interface GroomingRule {
  id: string;
  re: RegExp;
  severity: "review" | "critical";
}

const GROOMING_RULES: GroomingRule[] = [
  { id: "offplatform", re: /\b(add me on|message me on|find me on|whatsapp|snap(chat)?|telegram|give me your number|what'?s your number)\b/i, severity: "critical" },
  { id: "secrecy", re: /\b(don'?t tell (your )?(mom|dad|parents)|our (little )?secret|keep this between us|just between us)\b/i, severity: "critical" },
  { id: "images", re: /\b(send me (a )?(pic|pics|photo|photos|nudes?)|pics? of you|body pic)\b/i, severity: "critical" },
  { id: "meetup", re: /\b(meet (me )?alone|come over|my place|hotel room|when your parents .*(away|out))\b/i, severity: "critical" },
  { id: "flattery-isolation", re: /\b(you'?re so much more mature|only (someone|one) who understands (you|me)|we have a special bond)\b/i, severity: "review" },
  { id: "gifts", re: /\b(send you (money|a gift)|buy you (a )?(phone|gift))\b/i, severity: "review" },
];

export function scanGroomingCore(text: string): GroomingScanCore {
  const ruleIds: string[] = [];
  let severity: GroomingSeverity = "none";
  for (const p of GROOMING_RULES) {
    if (!p.re.test(text)) continue;
    ruleIds.push(p.id);
    if (p.severity === "critical") severity = "critical";
    else if (severity === "none") severity = "review";
  }
  return { severity, ruleIds };
}

/* ---------------- 53: video/post submission pre-check ---------------- */

export type PublishVerdict = "published" | "in_review" | "blocked";

export interface VideoScanCore {
  status: PublishVerdict;
  ruleIds: string[];
}

const RISKY_HASHTAG_RE = /\b(stunt|dangerous|extreme)\b/i;

/**
 * Decide the publish state for a post/video from its caption, hashtags and
 * audio-license flag. Mirrors client scanVideoSubmission semantics:
 *   - any block-severity signal ⇒ blocked (caller must not publish)
 *   - review signals ⇒ held for human moderation ("in_review")
 *   - minors are never auto-published past a review signal
 * (The client's info-level music-claim hints are a UX feature and are not
 * part of the enforcement decision, so they are not ported here.)
 */
export function scanVideoSubmissionCore(p: {
  caption: string;
  hashtags: string[];
  audioLicensed: boolean;
  creatorIsMinor: boolean;
}): VideoScanCore {
  const ruleIds: string[] = [];
  const groom = scanGroomingCore(p.caption);
  if (groom.severity !== "none") ruleIds.push(...groom.ruleIds);
  const comment = scanCommentCore(p.caption, p.creatorIsMinor);
  if (comment.verdict !== "clean") ruleIds.push(...comment.ruleIds);
  const riskyTag = p.hashtags.some((h) => RISKY_HASHTAG_RE.test(h));
  if (riskyTag) ruleIds.push("risky_hashtag");
  if (!p.audioLicensed) ruleIds.push("audio_unlicensed");

  const hasBlock = groom.severity === "critical" || comment.verdict === "blocked";
  const hasReview = groom.severity === "review" || comment.verdict === "hidden" || riskyTag || !p.audioLicensed;
  if (hasBlock) return { status: "blocked", ruleIds };
  if (hasReview) return { status: "in_review", ruleIds }; // minors included: held for human moderation
  return { status: "published", ruleIds };
}

/* ---------------- 40/43: messaging gate + contact pattern ---------------- */

export interface MessagingGateInput {
  fromIsAdult: boolean;
  fromIsVerifiedTeacher: boolean;
  toIsMinor: boolean;
  toPref: "everyone" | "followers" | "none";
  followingBack: boolean;
  isContact: boolean;
  isBlockedByEither: boolean;
}

export interface MessagingGateResult {
  allowed: boolean;
  /** Teacher↔minor conversations are guardian-visible — never secret. */
  guardianVisible?: boolean;
  flag?: "adult_to_minor" | "repeated_attempts";
}

/** Lockstep port of the client `canMessage` decision table. */
export function canMessageCore(ctx: MessagingGateInput): MessagingGateResult {
  if (ctx.isBlockedByEither) return { allowed: false };
  if (ctx.toPref === "none") return { allowed: false };
  if (!ctx.toIsMinor) {
    if (ctx.toPref === "followers" && !ctx.followingBack && !ctx.isContact) return { allowed: false };
    return { allowed: true };
  }
  // Recipient is a minor — platform-level protections on top of personal settings.
  if (!ctx.fromIsAdult && !ctx.followingBack && !ctx.isContact) return { allowed: false };
  if (ctx.fromIsAdult) {
    if (ctx.followingBack || ctx.isContact) return { allowed: true, guardianVisible: true };
    return { allowed: false, flag: "adult_to_minor" };
  }
  return { allowed: true, guardianVisible: true };
}

/** 18 = adult threshold (must match users.isMinor derivation in authInternals). */
export const ADULT_AGE = 18;
export const MINOR_CONTACT_ATTEMPT_LIMIT = 3;

/** Lockstep port of the client evaluateContactPattern math. */
export function evaluateContactPatternCore(attemptCount: number, toIsMinor: boolean): "none" | "watch" | "restrict" {
  if (!toIsMinor) return attemptCount >= 6 ? "watch" : "none";
  if (attemptCount > MINOR_CONTACT_ATTEMPT_LIMIT) return "restrict";
  if (attemptCount >= 2) return "watch";
  return "none";
}
