/**
 * DENSEN — Core database schema
 * ==============================
 * Single source of truth for the platform's data model.
 *
 * Conventions (enforced across every table):
 *  - `createdAt` / `updatedAt` epoch-millis on every mutable entity.
 *  - `ownerId` (or the natural owner field, e.g. senderId) on every user-created row.
 *  - Status machines use closed string unions (`v.union(...)`) — never bare strings.
 *  - Every high-volume table declares indexes for its hot query paths (see ARCHITECTURE.md).
 *
 * Identity strategy: Convex Auth owns `users`; domain identity lives in `profiles`
 * (dancer/teacher public data) and `teacherProfiles` (verification state). PII
 * (email, dob) stays in `users.private` and is NEVER returned by public queries.
 *
 * Modules (see ARCHITECTURE.md "Future module structure"):
 *  identity:    users, profiles, roles, teacherProfiles
 *  content:     videos, posts, comments, reactions, savedContent, copyrightClaims,
 *               copyrightDisputes, moderationActions
 *  social:      follows, messages, conversations, notifications
 *  learning:    classes, moves, combos, choreographies, courses, lessons, practiceSessions
 *  engagement:  challenges, challengeParticipants, xpTransactions, danceCredits,
 *               achievements, userAchievements, streaks
 *  commercial:  purchases, subscriptions, teacherPayouts
 *  governance:  reports, consents, privacySettings, devicePermissions, legalDocuments, auditLogs
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* ---------------- shared enums ---------------- */
const userRole = v.union(
  v.literal("user"), // dancer
  v.literal("teacher"),
  v.literal("moderator"),
  v.literal("admin")
);

const ageBand = v.union(
  v.literal("child_u13"), // platform-enforced protections (see src/data/safety.ts)
  v.literal("teen13_15"),
  v.literal("teen16_17"),
  v.literal("adult")
);

const publishStatus = v.union(
  v.literal("draft"),
  v.literal("in_review"), // moderation queue (youth-safety pre-publish review)
  v.literal("published"),
  v.literal("rejected"),
  v.literal("removed")
);

/* ---------------- identity module ---------------- */
const users = defineTable({
  // Auth-owned identity. Email is PII: written by auth flows, never joined into
  // public projections. `dob` exists for age-assurance only — it is never public.
  email: v.optional(v.string()), // unique; enforced by the users.email unique index
  dob: v.optional(v.string()), // "YYYY-MM-DD"; private
  ageBand: ageBand,
  ageAssurance: v.union(
    v.literal("self_declared"),
    v.literal("parental_consent"),
    v.literal("id_verified")
  ),
  role: userRole,
  isMinor: v.boolean(), // denormalized from ageBand for cheap guards
  status: v.union(
    v.literal("active"),
    v.literal("restricted"), // messaging/visibility limits applied (trust & safety)
    v.literal("suspended"),
    v.literal("deleted")
  ),
  lastActiveAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("email", ["email"]) // unique-by-convention: lookups must check emptiness first
  .index("by_role", ["role"]);

const profiles = defineTable({
  userId: v.id("users"),
  handle: v.string(), // unique-by-convention via the `handle` index
  displayName: v.string(),
  bio: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  styles: v.array(v.string()), // dance styles
  level: v.optional(v.string()), // beginner | intermediate | advanced | pro
  // Location is APPROXIMATE by design (city/region) — precise location is never stored.
  city: v.optional(v.string()),
  country: v.optional(v.string()),
  isPrivate: v.boolean(), // minors default true (safety defaults)
  // Reuse controls (remix/duet/download) — creator-owned, age-safe defaults.
  allowRemix: v.boolean(),
  allowDuet: v.boolean(),
  allowDownloads: v.boolean(),
  followerCount: v.number(), // denormalized counters, updated transactionally
  followingCount: v.number(),
  /** Dance Credits balance — denormalized from creditTransactions (source of truth).
   *  Updated in the same mutation that appends a credit transaction. */
  creditBalance: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("userId", ["userId"])
  .index("handle", ["handle"])
  .index("by_city", ["city"]);

const roles = defineTable({
  userId: v.id("users"),
  role: userRole,
  grantedBy: v.id("users"),
  reason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("userId", ["userId"])
  .index("by_role", ["role"]);

const teacherProfiles = defineTable({
  userId: v.id("users"),
  status: v.union(
    v.literal("pending"),
    v.literal("verified"),
    v.literal("rejected"),
    v.literal("revoked")
  ),
  displayName: v.string(),
  biography: v.optional(v.string()),
  styles: v.array(v.string()),
  // Verification artifacts: ids of securely-stored documents — never the documents themselves.
  verificationDocRefs: v.optional(v.array(v.string())),
  verifiedBy: v.optional(v.id("users")),
  verifiedAt: v.optional(v.number()),
  revenueSharePct: v.optional(v.number()), // set at contract time
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("userId", ["userId"])
  .index("by_status", ["status"]);

/* ---------------- learning module ---------------- */
const classes = defineTable({
  teacherId: v.id("users"),
  title: v.string(),
  style: v.string(),
  difficulty: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
  coverUrl: v.string(),
  altText: v.string(), // accessibility: every media row ships alt text
  /** Free vs paid classes: priceCents 0 = free; creditPrice enables
   *  Dance-Credit unlocking without touching the money rails. */
  priceCents: v.number(),
  creditPrice: v.number(),
  status: publishStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("teacherId", ["teacherId"])
  .index("by_style_status", ["style", "status"]);

const moves = defineTable({
  name: v.string(),
  style: v.string(),
  breakdownUrl: v.optional(v.string()),
  classId: v.optional(v.id("classes")),
  createdAt: v.number(),
}).index("by_style", ["style"]);

const combos = defineTable({
  name: v.string(),
  style: v.string(),
  moveIds: v.array(v.id("moves")),
  difficulty: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
  createdAt: v.number(),
}).index("by_style", ["style"]);

const choreographies = defineTable({
  authorId: v.id("users"), // dancer or teacher
  title: v.string(),
  comboId: v.optional(v.id("combos")),
  sourcePostId: v.optional(v.id("posts")), // born from a social post
  status: publishStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("authorId", ["authorId"]);

const courses = defineTable({
  teacherId: v.id("users"),
  title: v.string(),
  description: v.string(),
  style: v.string(),
  difficulty: v.union(v.literal("beginner"), v.literal("intermediate"), v.literal("advanced")),
  coverUrl: v.string(),
  altText: v.string(),
  priceCents: v.number(), // 0 = free
  currency: v.string(), // ISO 4217, shown before purchase (transparency)
  status: publishStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("teacherId", ["teacherId"])
  .index("by_style_status", ["style", "status"]);

const lessons = defineTable({
  courseId: v.id("courses"),
  position: v.number(),
  title: v.string(),
  videoRef: v.optional(v.string()), // storage ref; metadata only, URLs signed at read time
  durationSec: v.number(),
  xpReward: v.number(),
  status: publishStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_course_pos", ["courseId", "position"]);

const practiceSessions = defineTable({
  userId: v.id("users"),
  lessonId: v.id("lessons"),
  mode: v.union(v.literal("watch"), v.literal("learn"), v.literal("practice"), v.literal("complete")),
  seconds: v.number(),
  completed: v.boolean(),
  /** Practice-tool future: attempt video stored by reference (media module),
   *  moderation-gated, never the file itself. */
  attemptVideoRef: v.optional(v.string()),
  /** Future teacher/student comparison attaches to a session. */
  comparedWithUserId: v.optional(v.id("users")),
  createdAt: v.number(),
})
  .index("by_user_lesson", ["userId", "lessonId"])
  .index("by_user_recent", ["userId", "createdAt"]);

/* ---------------- content module ---------------- */
const videos = defineTable({
  ownerUserId: v.id("users"),
  storageRef: v.string(), // object key in object storage; signed URLs minted at read time
  thumbnailRef: v.optional(v.string()),
  altText: v.optional(v.string()),
  durationSec: v.number(),
  moderationStatus: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("flagged"),
    v.literal("removed")
  ),
  audioRef: v.optional(v.string()), // licensed audio registry ref
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner", ["ownerUserId"])
  .index("by_moderation", ["moderationStatus", "createdAt"]);

const posts = defineTable({
  userId: v.id("users"),
  videoId: v.optional(v.id("videos")),
  mediaUrl: v.optional(v.string()), // photo posts
  caption: v.string(),
  hashtags: v.array(v.string()),
  style: v.string(),
  audioRef: v.optional(v.string()),
  visibility: v.union(v.literal("public"), v.literal("followers"), v.literal("private")),
  // Duet/remix lineage
  duetOfPostId: v.optional(v.id("posts")),
  remixOfPostId: v.optional(v.id("posts")),
  originalCreatorId: v.optional(v.id("users")),
  status: publishStatus,
  likeCount: v.number(),
  commentCount: v.number(),
  viewCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user_status", ["userId", "status"]) // profile tab: someone's posts
  .index("by_status_created", ["status", "createdAt"]) // feed: newest published
  .index("by_hashtag", ["hashtags"]); // hashtag discovery (multi-entry index)

const comments = defineTable({
  postId: v.id("posts"),
  userId: v.id("users"),
  body: v.string(),
  parentId: v.optional(v.id("comments")),
  status: v.union(
    v.literal("visible"),
    v.literal("hidden"), // auto-filter or self-hidden
    v.literal("removed") // moderator action
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_post_status", ["postId", "status", "createdAt"]) // comment threads
  .index("by_user", ["userId"]);

const reactions = defineTable({
  // One row per (userId, targetType, targetId, kind). Uniqueness enforced
  // by read-before-write in the reaction mutation (see social.ts).
  userId: v.id("users"),
  targetType: v.union(v.literal("post"), v.literal("comment"), v.literal("course")),
  targetId: v.string(),
  kind: v.string(), // DENSEN social reaction vocabulary ("fire", "hype", "gold"…)
  createdAt: v.number(),
})
  .index("by_target", ["targetType", "targetId"]) // count per target
  .index("by_user_target", ["userId", "targetType", "targetId"]); // toggle lookups

const follows = defineTable({
  followerId: v.id("users"),
  followeeId: v.id("users"),
  createdAt: v.number(),
})
  .index("by_followee", ["followeeId"]) // follower list + counts
  .index("by_follower", ["followerId"]) // following list
  .index("by_follower_followee", ["followerId", "followeeId"]); // uniqueness lookup for the toggle

const savedContent = defineTable({
  userId: v.id("users"),
  targetType: v.union(
    v.literal("post"),
    v.literal("course"),
    v.literal("lesson"),
    v.literal("choreography"),
    v.literal("challenge"),
    v.literal("teacher")
  ),
  targetId: v.string(),
  createdAt: v.number(),
})
  .index("by_user_type", ["userId", "targetType"])
  .index("by_user_target", ["userId", "targetType", "targetId"]);

const copyrightClaims = defineTable({
  claimantUserId: v.id("users"),
  targetType: v.union(v.literal("post"), v.literal("course"), v.literal("audio")),
  targetId: v.string(),
  assertion: v.string(), // free-text statement of the claim
  status: v.union(
    v.literal("submitted"),
    v.literal("under_review"),
    v.literal("upheld"),
    v.literal("rejected"),
    v.literal("countered")
  ),
  reviewedBy: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_target", ["targetType", "targetId"])
  .index("by_status", ["status"]);

const copyrightDisputes = defineTable({
  claimId: v.id("copyrightClaims"),
  disputantUserId: v.id("users"),
  statement: v.string(),
  status: v.union(
    v.literal("submitted"),
    v.literal("under_review"),
    v.literal("resolved_upheld"),
    v.literal("resolved_released")
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_claim", ["claimId"]);

const moderationActions = defineTable({
  moderatorId: v.id("users"), // staff actor
  targetType: v.union(
    v.literal("post"),
    v.literal("comment"),
    v.literal("user"),
    v.literal("challenge"),
    v.literal("message")
  ),
  targetId: v.string(),
  action: v.union(
    v.literal("hide"),
    v.literal("remove"),
    v.literal("restrict_user"),
    v.literal("ban_user"),
    v.literal("dismiss")
  ),
  reason: v.string(),
  reportId: v.optional(v.id("reports")), // linkage to the originating report
  createdAt: v.number(),
})
  .index("by_target", ["targetType", "targetId"])
  .index("by_moderator", ["moderatorId", "createdAt"]);

/* ---------------- social module ---------------- */
const conversations = defineTable({
  kind: v.union(v.literal("direct"), v.literal("group")),
  memberUserIds: v.array(v.id("users")),
  title: v.optional(v.string()), // group title
  guardianVisible: v.boolean(), // youth-safety: minor↔teacher conversations
  lastMessageAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_member", ["memberUserIds"]) // multi-entry: matches per-member lookups
  .index("by_last_message", ["lastMessageAt"]);

const messages = defineTable({
  conversationId: v.id("conversations"),
  senderId: v.id("users"),
  body: v.optional(v.string()),
  // Rich payloads share DENSEN content into chats (lessons, posts, choreography)
  attachmentType: v.optional(
    v.union(v.literal("video"), v.literal("photo"), v.literal("lesson"), v.literal("post"), v.literal("choreography"))
  ),
  attachmentRef: v.optional(v.string()),
  attachmentTitle: v.optional(v.string()),
  flagged: v.boolean(), // set by the grooming/contact scanner before delivery
  createdAt: v.number(),
})
  .index("by_conversation_time", ["conversationId", "createdAt"]) // chat history
  .index("by_sender", ["senderId", "createdAt"]); // contact-pattern analysis

const notifications = defineTable({
  userId: v.id("users"), // recipient
  actorUserId: v.optional(v.id("users")),
  type: v.string(), // like | comment | follow | mention | challenge_invite | system…
  targetType: v.optional(v.string()),
  targetId: v.optional(v.string()),
  read: v.boolean(),
  createdAt: v.number(),
})
  .index("by_user_unread", ["userId", "read", "createdAt"]) // notification center
  .index("by_user_recent", ["userId", "createdAt"]);

/* ---------------- engagement module ---------------- */
const challenges = defineTable({
  title: v.string(),
  description: v.string(),
  tutorialCourseId: v.optional(v.id("courses")),
  deadlineAt: v.optional(v.number()),
  participantCount: v.number(),
  // Safety screening result (dangerous-pattern scan before creation)
  safetyStatus: v.union(v.literal("cleared"), v.literal("flagged"), v.literal("blocked")),
  status: publishStatus,
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_status_deadline", ["status", "deadlineAt"]);

const challengeParticipants = defineTable({
  challengeId: v.id("challenges"),
  userId: v.id("users"),
  entryPostId: v.optional(v.id("posts")),
  joinedAt: v.number(),
})
  .index("by_challenge", ["challengeId"]) // participant list + leaderboard
  .index("by_user", ["userId"]); // "my challenges"

const xpTransactions = defineTable({
  userId: v.id("users"),
  amount: v.number(), // signed
  reason: v.string(), // lesson_complete | post_publish | challenge_join | streak | grant…
  refType: v.optional(v.string()),
  refId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_user_time", ["userId", "createdAt"]) // history + balance derivation
  .index("by_reason", ["reason"]);

const danceCredits = defineTable({
  userId: v.id("users"),
  amount: v.number(), // signed; balance = sum
  reason: v.string(), // purchase | earn | spend | refund | expire
  expiresAt: v.optional(v.number()),
  refType: v.optional(v.string()),
  refId: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_user_time", ["userId", "createdAt"]);

/**
 * Credit transactions — the durable, auditable double-entry for Dance Credits.
 * `danceCredits` rows remain the ledger of individual grants; every mutation of a
 * user's balance ALSO writes one row here with the resulting balance snapshot, so
 * balances can be verified and disputes can be reconstructed. Balance reads use
 * `profiles.creditBalance` (denormalized); this table is the source of truth.
 */
const creditTransactions = defineTable({
  userId: v.id("users"),
  amount: v.number(), // signed
  /** Balance AFTER applying this transaction (audit/reconciliation snapshot). */
  balanceAfter: v.number(),
  reason: v.union(
    v.literal("earn"),
    v.literal("purchase"),
    v.literal("spend"),
    v.literal("reward"),
    v.literal("refund"),
    v.literal("expire"),
    v.literal("admin_adjust")
  ),
  refType: v.optional(v.string()), // mission | purchase | challenge | class_unlock …
  refId: v.optional(v.string()),
  /** Idempotency: one grant per (reason, ref) per user — enforced by
   *  read-before-write on this index in the credits module. */
  createdAt: v.number(),
})
  .index("by_user_time", ["userId", "createdAt"])
  .index("by_user_reason_ref", ["userId", "reason", "refId"]);

const achievements = defineTable({
  code: v.string(), // unique-by-convention, e.g. "first_class"
  title: v.string(),
  description: v.string(),
  xpReward: v.number(),
  criteria: v.string(), // human-readable rule; evaluation lives server-side
  createdAt: v.number(),
}).index("by_code", ["code"]);

const userAchievements = defineTable({
  userId: v.id("users"),
  achievementId: v.id("achievements"),
  progress: v.number(), // 0-100 until unlocked
  unlockedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_achievement", ["userId", "achievementId"]); // uniqueness lookup

const streaks = defineTable({
  userId: v.id("users"),
  currentLength: v.number(),
  bestLength: v.number(),
  lastActivityDay: v.string(), // "YYYY-MM-DD" — one activity per day
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_user", ["userId"]);

/* ---------------- arcade: missions (goal-shaped XP/credit rewards) ---------------- */
const missions = defineTable({
  code: v.string(), // unique-by-convention, e.g. "week1_watch_3_lessons"
  title: v.string(),
  description: v.string(),
  /** Human-readable completion rule; evaluation is server-side. */
  criteria: v.string(),
  xpReward: v.number(),
  creditReward: v.number(),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()), // undefined = evergreen mission
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("retired")),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_status_window", ["status", "endsAt"]);

const userMissions = defineTable({
  userId: v.id("users"),
  missionId: v.id("missions"),
  progress: v.number(), // 0-100
  completedAt: v.optional(v.number()),
  claimedAt: v.optional(v.number()), // reward grant is idempotent via this field
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_mission", ["userId", "missionId"]); // uniqueness lookup

/* ---------------- commercial module ---------------- */
const purchases = defineTable({
  userId: v.id("users"),
  courseId: v.id("courses"),
  amountCents: v.number(),
  currency: v.string(),
  // Real money state lives in the payment provider; this mirrors provider state.
  provider: v.string(), // "stripe" | "apple" | "google"
  providerRef: v.string(), // provider intent/transaction id — source of truth for money
  status: v.union(
    v.literal("pending"),
    v.literal("paid"),
    v.literal("refunded"),
    v.literal("failed")
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"]) // entitlement checks + purchase history
  .index("by_user_course", ["userId", "courseId"]) // owns(course) lookup
  .index("by_provider_ref", ["providerRef"]); // webhook idempotency

const subscriptions = defineTable({
  userId: v.id("users"),
  plan: v.string(),
  priceCents: v.number(),
  currency: v.string(),
  interval: v.union(v.literal("month"), v.literal("year")),
  provider: v.string(),
  providerRef: v.string(),
  cancelAtPeriodEnd: v.boolean(),
  status: v.union(
    v.literal("incomplete"),
    v.literal("active"),
    v.literal("past_due"),
    v.literal("canceled")
  ),
  currentPeriodEnd: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_provider_ref", ["providerRef"]);

const paymentTransactions = defineTable({
  /** Provider-authoritative money event log. `purchases` mirror readable state;
   *  every state change arrives here first via an authenticated, signature-verified
   *  webhook (raw-body HMAC + timestamp tolerance — see ARCHITECTURE.md §6).
   */
  provider: v.string(), // "stripe" | "apple" | "google"
  /** Provider event id — the webhook idempotency key. */
  providerEventRef: v.string(),
  purchaseId: v.optional(v.id("purchases")),
  userId: v.optional(v.id("users")), // denormalized for fast user-scoped reads
  kind: v.union(
    v.literal("charge"),
    v.literal("refund"),
    v.literal("chargeback"),
    v.literal("payout")
  ),
  amountCents: v.number(), // signed from the platform's perspective
  currency: v.string(),
  rawStatus: v.string(), // provider's own status string, preserved for reconciliation
  createdAt: v.number(),
})
  .index("by_provider_event", ["provider", "providerEventRef"]) // webhook idempotency
  .index("by_purchase", ["purchaseId"])
  .index("by_user_time", ["userId", "createdAt"]);

const refundRequests = defineTable({
  /** User-visible refund requests. The actual money movement is performed by the
   *  payment provider after staff review — never simulated in-app (no fake refunds).
   */
  purchaseId: v.id("purchases"),
  userId: v.id("users"),
  reason: v.string(),
  status: v.union(
    v.literal("requested"),
    v.literal("under_review"),
    v.literal("approved"),
    v.literal("refunded"),
    v.literal("rejected")
  ),
  reviewedBy: v.optional(v.id("users")),
  providerRefundRef: v.optional(v.string()), // filled only after the provider confirms
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_purchase", ["purchaseId"])
  .index("by_status_time", ["status", "createdAt"])
  .index("by_user", ["userId"]);

const teacherPayouts = defineTable({
  teacherUserId: v.id("users"),
  amountCents: v.number(),
  currency: v.string(),
  periodStart: v.number(),
  periodEnd: v.number(),
  status: v.union(
    v.literal("accruing"),
    v.literal("scheduled"),
    v.literal("paid"),
    v.literal("reversed")
  ),
  providerRef: v.optional(v.string()), // transfer id from the payout provider
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_teacher", ["teacherUserId", "createdAt"]);

/* ---------------- governance module ---------------- */
const blocks = defineTable({
  /** User-initiated block. All message/comment/recommendation paths must honor it
   *  (the messaging gate in src/data/safety.ts already treats blocks as absolute).
   */
  blockerId: v.id("users"),
  blockedId: v.id("users"),
  reason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_blocker", ["blockerId", "blockedId"]) // uniqueness + isBlocked lookups
  .index("by_blocked", ["blockedId"]); // reverse lookup

const reports = defineTable({
  reporterId: v.id("users"),
  targetType: v.union(
    v.literal("post"),
    v.literal("comment"),
    v.literal("user"),
    v.literal("message"),
    v.literal("challenge")
  ),
  targetId: v.string(),
  category: v.string(), // includes dedicated child_safety (highest priority)
  details: v.string(),
  priority: v.union(v.literal("critical"), v.literal("high"), v.literal("normal")),
  status: v.union(
    v.literal("open"),
    v.literal("reviewing"),
    v.literal("resolved"),
    v.literal("dismissed")
  ),
  assignedTo: v.optional(v.id("users")), // moderator — role-checked before reads
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_status_priority", ["status", "priority", "createdAt"]) // moderation queue
  .index("by_target", ["targetType", "targetId"])
  .index("by_reporter", ["reporterId"]);

const consents = defineTable({
  userId: v.id("users"),
  type: v.string(), // terms | privacy | guidelines | marketing | personalization | content_license | music_rights | cookies…
  granted: v.boolean(), // withdrawal is recorded as a new row (append-only history)
  version: v.string(), // policy version accepted
  region: v.string(),
  source: v.string(), // form/screen that captured it
  createdAt: v.number(),
})
  .index("by_user_type_time", ["userId", "type", "createdAt"]) // consent history (immutable)
  .index("by_user", ["userId"]);

const privacySettings = defineTable({
  userId: v.id("users"),
  privateAccount: v.boolean(),
  messagesFrom: v.union(v.literal("everyone"), v.literal("followers"), v.literal("none")),
  commentFilter: v.boolean(),
  discoverableByHandle: v.boolean(),
  showCity: v.boolean(), // approximate location only, user-controlled
  personalization: v.boolean(),
  updatedAt: v.number(),
}).index("by_user", ["userId"]);

const devicePermissions = defineTable({
  userId: v.id("users"),
  permission: v.union(
    v.literal("camera"),
    v.literal("microphone"),
    v.literal("photos"),
    v.literal("location"),
    v.literal("notifications")
  ),
  state: v.union(v.literal("unknown"), v.literal("granted"), v.literal("denied"), v.literal("blocked")),
  requestedAt: v.optional(v.number()),
  updatedAt: v.number(),
})
  .index("by_user_permission", ["userId", "permission"]) // one row per (user, permission)
  .index("by_state", ["state"]);

const legalDocuments = defineTable({
  docId: v.string(), // privacy | terms | cookies | refunds | guidelines
  version: v.string(),
  locale: v.string(), // "en" | "sq" | …
  status: v.union(v.literal("draft"), v.literal("active"), v.literal("retired")),
  effectiveAt: v.number(),
  contentRef: v.string(), // storage/markdown ref — content not inlined in the row
  createdAt: v.number(),
})
  .index("by_doc_version", ["docId", "version"])
  .index("by_doc_status", ["docId", "status"]);

const auditLogs = defineTable({
  actorUserId: v.optional(v.id("users")), // system events may have no actor
  actorRole: v.optional(userRole),
  eventType: v.string(), // age_verification | safety_report | moderation_decision |
  // account_restriction | block | appeal | teacher_verification |
  // parental_request | content_removal | consent_change | auth_event…
  targetType: v.optional(v.string()),
  targetId: v.optional(v.string()),
  summary: v.string(), // what happened — no PII payloads
  // Immutable chain anchors; append-only writes only (write helpers reject updates).
  prevHash: v.optional(v.string()),
  hash: v.optional(v.string()),
  createdAt: v.number(),
})
  .index("by_time", ["createdAt"]) // chronological audit trail
  .index("by_event", ["eventType", "createdAt"])
  .index("by_actor", ["actorUserId", "createdAt"]);

export default defineSchema({
  users,
  profiles,
  roles,
  teacherProfiles,
  classes,
  moves,
  combos,
  choreographies,
  courses,
  lessons,
  practiceSessions,
  videos,
  posts,
  comments,
  reactions,
  follows,
  savedContent,
  copyrightClaims,
  copyrightDisputes,
  moderationActions,
  blocks,
  conversations,
  messages,
  notifications,
  challenges,
  challengeParticipants,
  xpTransactions,
  danceCredits,
  creditTransactions,
  achievements,
  userAchievements,
  streaks,
  missions,
  userMissions,
  purchases,
  paymentTransactions,
  refundRequests,
  subscriptions,
  teacherPayouts,
  reports,
  consents,
  privacySettings,
  devicePermissions,
  legalDocuments,
  auditLogs,
});
