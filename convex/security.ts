/**
 * DENSEN — Security & authorization layer (fail-closed)
 * =====================================================
 * Pure, unit-testable authorization core + thin audit sink.
 *
 * Design rules (ARCHITECTURE.md → Security model):
 *  1. FAIL CLOSED — no identity / no role row means DENY, never a fallback.
 *  2. Identity comes from the server-side auth session, never from args.
 *  3. Public reads route through the PII-stripping sanitizers in `validators.ts`;
 *     no query returns raw user rows.
 *  4. Role grants are explicit (`roleAtLeast`) — no implicit admin superuser.
 *  5. Security-relevant decisions append to the immutable audit log.
 *
 * NOTE ON CODEGEN: the generated `_generated/server` bindings require a linked
 * Convex deployment; this environment runs the local backend only. The layer is
 * therefore split: pure functions here (testable without codegen) + wire modules
 * in `social.ts` importing `convex/server` directly.
 */
import { appendAudit, type AuditEntry } from "./auditInternals";
import { publicProfileOf, publicPostOf, type PublicProfileDTO, type PublicPostDTO } from "./validators";

export { publicProfileOf, publicPostOf };
export type { PublicProfileDTO, PublicPostDTO };

/* ---------------- roles ---------------- */
export type Role = "user" | "teacher" | "moderator" | "admin";
export const ROLE_RANK: Record<Role, number> = { user: 1, teacher: 2, moderator: 3, admin: 4 };

/** Explicit grant check — undefined role fails closed. */
export function roleAtLeast(actual: Role | undefined, required: Role): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

/* ---------------- caller context ---------------- */
/**
 * The identity a request carries. Built ONLY from the server-verified auth
 * session (`ctx.auth.getUserIdentity()` → users lookup) — never from arguments.
 */
export interface Caller {
  userId: string;
  role: Role;
  userStatus: "active" | "restricted" | "suspended" | "deleted";
}

/** Guard: require any authenticated, non-deleted caller. Throws = deny. */
export function requireUser(me: Caller | null): Caller {
  if (!me) throw new Error("UNAUTHENTICATED");
  if (me.userStatus === "deleted") throw new Error("FORBIDDEN:account_deleted");
  return me;
}

/** Guard: role check. Suspended users keep no role privileges (fail closed). */
export function requireRole(me: Caller | null, required: Role): Caller {
  const caller = requireUser(me);
  if (caller.userStatus === "suspended") throw new Error("FORBIDDEN:account_suspended");
  if (!roleAtLeast(caller.role, required)) throw new Error(`FORBIDDEN:${required}`);
  return caller;
}

/** Guard: caller must own the resource. Returns caller on success. */
export function requireOwner(me: Caller | null, ownerId: string): Caller {
  const caller = requireUser(me);
  if (caller.userId !== ownerId) throw new Error("FORBIDDEN:not_owner");
  return caller;
}

/** Self OR staff (moderator+). */
export function requireSelfOrStaff(me: Caller | null, ownerId: string): Caller {
  const caller = requireUser(me);
  if (caller.userId === ownerId || roleAtLeast(caller.role, "moderator")) return caller;
  throw new Error("FORBIDDEN");
}

/* ---------------- visibility ---------------- */
export interface ProfileVisibilityInput {
  targetUserStatus: "active" | "restricted" | "suspended" | "deleted";
  isPrivate: boolean;
  viewerIsFollower: boolean;
  viewerRole: Role | undefined;
  viewerIsSelf: boolean;
}

/**
 * Server-side visibility rule. Guests (`viewerRole === undefined`) can only
 * see public profiles. Private profiles: self, followers, staff.
 */
export function canViewProfile(v: ProfileVisibilityInput): boolean {
  if (v.viewerIsSelf) return true;
  if (v.targetUserStatus === "deleted" || v.targetUserStatus === "suspended") return false;
  if (!v.isPrivate) return true;
  if (v.viewerRole === undefined) return false; // guest sees nothing private
  if (roleAtLeast(v.viewerRole, "moderator")) return true;
  return v.viewerIsFollower;
}

/* ---------------- report targets ---------------- */
export const REPORTABLE = ["post", "comment", "user", "message", "challenge"] as const;
export type ReportableType = (typeof REPORTABLE)[number];

/** Typed resolver: unknown target types are rejected, never blindly stored. */
export function parseReportTarget(
  targetType: string,
  targetId: string
): { targetType: ReportableType; targetId: string } | null {
  return (REPORTABLE as readonly string[]).includes(targetType) && targetId.length > 0
    ? { targetType: targetType as ReportableType, targetId }
    : null;
}

/* ---------------- audit ---------------- */
export type { AuditEntry };
/**
 * Minimal db shape the audit sink needs — satisfied by Convex `ctx.db` and by
 * test doubles. Append-only: no update/delete path exists anywhere.
 */
export type AuditSink = { insert: (table: "auditLogs", row: AuditEntry & { createdAt: number }) => Promise<void> };

export function appendAuditEntry(sink: AuditSink, entry: AuditEntry): Promise<void> {
  return appendAudit(sink, entry);
}
