/**
 * Append-only audit log write helper + entry contract.
 * Deliberately minimal: NO update/delete path exists for audit rows anywhere —
 * history is immutable by construction. Reads are restricted to moderators+
 * in the admin module (never exposed through public queries).
 */
export interface AuditEntry {
  /** System events may have no actor. */
  actorUserId?: string;
  actorRole?: "user" | "teacher" | "moderator" | "admin";
  /** age_verification | safety_report | moderation_decision | account_restriction |
   *  block | appeal | teacher_verification | parental_request | content_removal |
   *  consent_change | auth_event | follow | unfollow | … */
  eventType: string;
  targetType?: string;
  targetId?: string;
  /** What happened — human-readable, no PII payloads. */
  summary: string;
}

/** Insert-only sink. Matches Convex `ctx.db.insert("auditLogs", …)` structurally. */
export async function appendAudit(
  sink: { insert: (table: "auditLogs", row: never) => Promise<void> },
  entry: AuditEntry
): Promise<void> {
  await sink.insert("auditLogs", {
    ...entry,
    createdAt: Date.now(),
  } as never);
}
