/**
 * DENSEN — Messaging internals (Day 16).
 * =====================================
 * Database helpers shared by the messaging wire layer and the legacy
 * content.ts DM path.
 *
 * Convex array-field index entries only match the FULL array value, so the
 * `conversations.by_member` index cannot answer "threads containing user X"
 * when the user is one of several members. These helpers maintain and read
 * `conversationMembers` — one scalar row per member — so membership lookups
 * are real index probes. The authoritative membership list remains
 * `conversations.memberUserIds`; mirror rows are an index, not a source of
 * truth. Legacy threads without mirror rows are backfilled lazily on first
 * touch (additive, zero-risk).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The caller's conversations via per-member mirror rows.
 *
 * If the user has NO mirror rows at all (legacy account created before the
 * mirror existed), this falls back to a bounded full-table scan of
 * `conversations` so pre-existing threads stay visible; the send path then
 * backfills mirror rows via `ensureConversationMembers` so the scan
 * self-heals after the first touch.
 */
export async function conversationMembersOf(db: any, userId: string): Promise<any[]> {
  const memberRows = (await db
    .query("conversationMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect()) as { conversationId: string }[];
  if (memberRows.length === 0) {
    const all = (await db.query("conversations").collect()) as { memberUserIds?: string[] }[];
    return all.filter((c) => (c.memberUserIds ?? []).some((m) => String(m) === String(userId)));
  }
  const seen = new Set<string>();
  const convos: any[] = [];
  for (const m of memberRows) {
    if (seen.has(m.conversationId)) continue;
    seen.add(m.conversationId);
    const c = (await db.get(m.conversationId as never)) as any;
    if (c) convos.push(c);
  }
  return convos;
}

/** Writes the missing mirror rows for a conversation (legacy backfill). */
export async function ensureConversationMembers(db: any, conversationId: string): Promise<void> {
  const existing = (await db
    .query("conversationMembers")
    .withIndex("by_conversation", (q: any) => q.eq("conversationId", conversationId))
    .collect()) as unknown[];
  if (existing.length > 0) return;
  const convo = (await db.get(conversationId as never)) as { memberUserIds?: string[] } | null;
  if (!convo?.memberUserIds) return;
  const now = Date.now();
  for (const uid of convo.memberUserIds) {
    await db.insert("conversationMembers", { conversationId: conversationId as never, userId: uid as never, createdAt: now });
  }
}
