/**
 * DENSEN — Social/event notification helpers (Day 16).
 * ===================================================
 * Thin wrappers that name the platform's notification events and route them
 * through the shared pref-checked emit (notifyUser). Every producer in the
 * codebase should call these instead of raw notifications inserts so category
 * mutes and no-self-notify hold everywhere:
 *
 *   notifyFollow        — new follower
 *   notifyTeacherEvent  — teacher activity (new class / going live)
 *   notifyChallenge     — challenge events (invite / join / result)
 *   notifyPurchase      — purchase + refund receipts
 *   notifySecurity      — password/session events (category unmutable)
 */
import { notifyUser } from "./notifyInternals";

interface NotifyDb {
  get(id: unknown): Promise<unknown>;
  insert(table: string, row: Record<string, unknown>): Promise<unknown>;
  query?(table: string): any;
}

export async function notifyFollow(
  db: NotifyDb,
  n: { followerUserId: string; followedUserId: string; now: number }
): Promise<boolean> {
  return notifyUser(db, {
    userId: n.followedUserId,
    actorUserId: n.followerUserId,
    type: "follow",
    targetType: "user",
    targetId: n.followerUserId,
    now: n.now,
  });
}

export async function notifyTeacherEvent(
  db: NotifyDb,
  n: { teacherUserId: string; kind: "teacher_new_class" | "teacher_live"; title: string; refId: string; now: number; followerIds?: string[] }
): Promise<number> {
  // v1: the teacher's own audience fanout arrives with the follow-graph work;
  // today the event itself notifies the teacher (their studio event) and any
  // explicitly passed follower ids.
  let sent = 0;
  const targets = new Set<string>([n.teacherUserId, ...(n.followerIds ?? [])]);
  for (const userId of targets) {
    const ok = await notifyUser(db, {
      userId,
      actorUserId: userId === n.teacherUserId ? undefined : n.teacherUserId,
      type: n.kind,
      targetType: "class",
      targetId: n.refId,
      now: n.now,
    });
    if (ok) sent += 1;
  }
  return sent;
}

export async function notifyChallenge(
  db: NotifyDb,
  n: {
    type: "challenge_invite" | "challenge_joined" | "challenge_result";
    recipientUserId: string;
    actorUserId?: string;
    challengeId: string;
    now: number;
  }
): Promise<boolean> {
  return notifyUser(db, {
    userId: n.recipientUserId,
    actorUserId: n.actorUserId,
    type: n.type,
    targetType: "challenge",
    targetId: n.challengeId,
    now: n.now,
  });
}

export async function notifyPurchase(
  db: NotifyDb,
  n: {
    type: "purchase_paid" | "refund_approved" | "refund_rejected" | "refund_requested";
    userId: string;
    actorUserId?: string;
    purchaseId: string;
    now: number;
  }
): Promise<boolean> {
  return notifyUser(db, {
    userId: n.userId,
    actorUserId: n.actorUserId,
    type: n.type,
    targetType: "purchase",
    targetId: n.purchaseId,
    now: n.now,
  });
}

/**
 * SECURITY notices. The security category is NEVER mutable — every call
 * delivers (notifyUser still guards self-notify; server events have no
 * actor so they always deliver).
 */
export async function notifySecurity(
  db: NotifyDb,
  n: {
    type:
      | "security_password_changed"
      | "security_new_device"
      | "security_session_revoked"
      | "security_login_blocked"
      | "security_account_locked";
    userId: string;
    now: number;
  }
): Promise<boolean> {
  return notifyUser(db, {
    userId: n.userId,
    type: n.type,
    targetType: "security",
    targetId: undefined,
    now: n.now,
  });
}
