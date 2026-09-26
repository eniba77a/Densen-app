/**
 * DENSEN — Notification internals (Day 16).
 * ========================================
 * Pure decision cores for the notification center:
 *   - category taxonomy (the 12 user-facing groups)
 *   - age-aware default preference sets
 *   - the per-category opt-out decision (decidePrefChange)
 *   - the per-row deliverability decision (decideDelivery) — the ONLY place
 *     where a category muted by the recipient suppresses a notification.
 *   - the shared emit helper (notifyUser) used by every producer.
 *
 * The map from raw event types (interaction_move, purchase_paid,
 * copyright_claim…) to categories lives in NOTIFICATION_CATEGORIES so
 * both the producer wiring and the settings UI speak the same vocabulary.
 *
 * No fake push notifications: DENSEN has no OS-push channel wired, so this
 * module only ever writes rows into the real `notifications` table (read in
 * the in-app notification center) and (optionally) transactional EMAIL rows
 * through the existing auth email action for security-critical events.
 */
import type { ServerAgeBand } from "./authInternals";

/* ================================================================== */
/*                        Category taxonomy                            */
/* ================================================================== */

/** The 12 user-facing notification categories (the product brief's list). */
export const NOTIFICATION_CATEGORIES = [
  "social", // new follower
  "energy", // fire/hype/gold + quick reactions
  "comments", // comment / comment reaction
  "shares", // move/share + remix/duet + DM shares
  "practice", // practice nudges + MY PRACTICE activity
  "challenges", // invites, joins, results
  "achievements", // badges, streak milestones, level ups
  "learning", // class/course completion + teacher activity (new classes, live)
  "messages", // DMs, group chats, challenge invitations via chat
  "purchases", // receipts, refunds, credits
  "moderation", // reports, appeals, account decisions
  "security", // password, sessions, suspicious activity — NEVER mutable
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories a user may opt out of. Security can never be muted. */
export const MUTABLE_CATEGORIES = NOTIFICATION_CATEGORIES.filter((c) => c !== "security");

export function isNotificationCategory(c: string): c is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(c);
}

/** Maps every raw notification `type` the platform emits to its category. */
export const TYPE_CATEGORY: Record<string, NotificationCategory> = {
  // social
  follow: "social",
  // energy + comments + shares (post surface)
  interaction_fire: "energy",
  interaction_hype: "energy",
  interaction_gold: "energy",
  interaction_energy: "energy",
  interaction_on_point: "energy",
  interaction_vibe: "energy",
  interaction_insane: "energy",
  interaction_clean: "energy",
  interaction_power: "energy",
  reaction: "energy",
  comment: "comments",
  comment_reaction: "comments",
  interaction_move: "shares",
  interaction_practice: "practice",
  interaction_boost: "shares",
  interaction_challenge: "challenges",
  interaction_remix: "shares",
  interaction_duet: "shares",
  // challenges
  challenge_invite: "challenges",
  challenge_joined: "challenges",
  challenge_result: "challenges",
  // learning
  class_completed: "learning",
  course_completed: "learning",
  teacher_new_class: "learning",
  teacher_live: "learning",
  // messages
  message: "messages",
  message_share: "messages",
  // achievements + practice
  achievement_unlocked: "achievements",
  streak_milestone: "achievements",
  practice_milestone: "practice",
  // purchases
  purchase_paid: "purchases",
  refund_approved: "purchases",
  refund_rejected: "purchases",
  refund_requested: "purchases",
  credits_reward: "purchases",
  // moderation
  moderation_action: "moderation",
  appeal_reviewed: "moderation",
  copyright_claim: "moderation",
  copyright_claim_update: "moderation",
  copyright_dispute_update: "moderation",
  // security
  security_password_changed: "security",
  security_new_device: "security",
  security_session_revoked: "security",
  security_login_blocked: "security",
  security_account_locked: "security",
};

/** Category for a raw type (unknown types are moderation-safe by default). */
export function categoryForType(type: string): NotificationCategory {
  return TYPE_CATEGORY[type] ?? "moderation";
}

/* ================================================================== */
/*                     Age-aware default preferences                   */
/* ================================================================== */

/** Younger dancers get quieter default inboxes; everyone can adjust later. */
export function defaultMutedFor(band: ServerAgeBand): NotificationCategory[] {
  if (band === "child_u13") {
    // Strictest: only the essentials + safety stay on.
    return ["social", "energy", "shares", "practice", "challenges", "achievements", "learning", "messages", "purchases"];
  }
  if (band === "teen13_15") {
    return ["energy", "shares", "purchases"];
  }
  return []; // teen16_17 + adult: all categories on by default
}

/* ================================================================== */
/*                          Preference decisions                       */
/* ================================================================== */

export interface PrefChangeInput {
  /** The caller's own current muted list (never another user's). */
  currentMuted: NotificationCategory[];
  category: string;
  /** true = the user wants this category to deliver again (opt back in). */
  enable: boolean;
}

export type PrefChangeDecision =
  | { action: "allow"; muted: NotificationCategory[] }
  | { action: "deny"; error: "unauthenticated" | "invalid_category" | "security_immutable" };

/**
 * Decide a preference toggle. Fail-closed: unknown categories are rejected
 * (closed vocabulary), and `security` can NEVER be muted.
 */
export function decidePrefChange(input: PrefChangeInput): PrefChangeDecision {
  if (!isNotificationCategory(input.category)) {
    return { action: "deny", error: "invalid_category" };
  }
  const next = new Set(input.currentMuted);
  if (input.enable) {
    next.delete(input.category);
  } else {
    if (input.category === "security") return { action: "deny", error: "security_immutable" };
    next.add(input.category);
  }
  // Canonical order for stable storage + comparisons.
  const muted = NOTIFICATION_CATEGORIES.filter((c) => next.has(c));
  return { action: "allow", muted };
}

/* ================================================================== */
/*                           Delivery decision                         */
/* ================================================================== */

export interface DeliveryInput {
  /** Recipient's muted categories (empty = all categories deliver). */
  recipientMuted: NotificationCategory[];
  /** The raw event type (category derived from it). */
  type: string;
  /** Actor, when the notification is caused by another user. */
  actorUserId?: string;
  recipientUserId: string;
}

export type DeliveryDecision = { action: "deliver" } | { action: "suppress"; reason: "category_muted" | "self_notify" };

/**
 * The ONLY suppression point: muted categories never deliver, and no user is
 * ever notified about their own action. Fail-open for category mapping
 * (unknown types map to moderation, which stays deliverable).
 */
export function decideDelivery(input: DeliveryInput): DeliveryDecision {
  if (input.actorUserId && input.actorUserId === input.recipientUserId) {
    return { action: "suppress", reason: "self_notify" };
  }
  const category = categoryForType(input.type);
  if (input.recipientMuted.includes(category)) return { action: "suppress", reason: "category_muted" };
  return { action: "deliver" };
}

/* ================================================================== */
/*                          Shared emit helper                         */
/* ================================================================== */

/** Minimal db shape every producer passes (Convex mutation ctx.db). */
export interface NotifyDb {
  get(id: unknown): Promise<unknown>;
  insert(table: string, row: Record<string, unknown>): Promise<unknown>;
  query?(table: string): any;
}

async function mutedFor(db: NotifyDb, userId: string): Promise<NotificationCategory[]> {
  if (!db.query) return [];
  const row = (await db
    .query("notificationPrefs")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique()) as { mutedCategories?: NotificationCategory[] } | null;
  return row?.mutedCategories ?? [];
}

/**
 * Pref-checked notification insert — the ONE entry point producers use.
 * Honors: recipient's category mutes, no-self-notify, no-PII payloads.
 * Security-critical events bypass nothing except being unmutable — the
 * recipient can still silence everything else.
 */
export async function notifyUser(
  db: NotifyDb,
  n: {
    userId: string;
    actorUserId?: string;
    type: string;
    targetType?: string;
    targetId?: string;
    now: number;
  }
): Promise<boolean> {
  const decision = decideDelivery({
    recipientMuted: await mutedFor(db, n.userId),
    type: n.type,
    actorUserId: n.actorUserId,
    recipientUserId: n.userId,
  });
  if (decision.action === "suppress") return false;
  await db.insert("notifications", {
    userId: n.userId as never,
    actorUserId: n.actorUserId ? (n.actorUserId as never) : undefined,
    type: n.type,
    targetType: n.targetType,
    targetId: n.targetId,
    read: false,
    createdAt: n.now,
  });
  return true;
}

/** Convenience: does a raw type deliver for this recipient's mutes? */
export function typeDelivers(muted: NotificationCategory[], type: string, actorUserId?: string, recipientUserId?: string): boolean {
  if (actorUserId && recipientUserId && actorUserId === recipientUserId) return false;
  return !muted.includes(categoryForType(type));
}
