/**
 * DENSEN — Messaging (Day 16).
 * ===========================
 * Two honest worlds in one route:
 *   - Signed in: REAL conversations, REAL user search, REAL typed shares,
 *     REAL read state — all through messagingWire (identity from the session,
 *     every gate re-decided server-side; the client canMessage preview is UX
 *     only and can never unlock anything).
 *   - Guest: the prototype conversation mirror (clearly labeled preview).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, Empty, Page } from "../components/ui";
import { IcSend, IcVerified } from "../components/icons";
import { useStore } from "../state/store";
import { conversations, courses, userById } from "../data/store";
import type { ChatMessage } from "../data/store";
import { IMG } from "../data/media";
import { useGov } from "../state/governance";
import { ReportModal, tx } from "../components/gov-ui";
import { canMessage } from "../data/safety";
import { useAuth } from "../state/auth";
import type { Lang } from "../i18n";

/* ============================================================================ */
/*                          Server-backed messaging                              */
/* ============================================================================ */

/** Projection of messagingWire.listMyConversations rows. */
interface ServerConvo {
  id: string;
  otherUserId: string;
  otherHandle: string;
  otherDisplayName: string;
  otherAvatarUrl?: string;
  guardianVisible: boolean;
  lastMessageAt?: number;
  lastMessagePreview: string;
  unread: number;
  muted: boolean;
  blocked: boolean;
}

/** Projection of messagingWire.getConversation messages. */
interface ServerMsg {
  id: string;
  mine: boolean;
  senderId: string;
  body: string;
  shareKind?: string;
  attachmentType?: string;
  attachmentRef?: string;
  attachmentTitle?: string;
  flagged: boolean;
  createdAt: number;
}

const SHARE_LABEL_KEYS: Record<string, string> = {
  video: "messages.shareVideo",
  class: "messages.shareClass",
  course: "messages.shareCourse",
  combo: "messages.shareCombo",
  choreography: "messages.shareChoreo",
  post: "messages.sharePost",
  challenge_invite: "messages.shareChallenge",
};

/** Client mirror of the wire error vocabulary (the server remains authoritative). */
const ERROR_KEYS: Record<string, string> = {
  blocked: "messages.errBlocked",
  adult_to_minor: "messages.errAdultMinor",
  minor_gate: "messages.errMinorGate",
  messaging_off: "messages.errMessagingOff",
  followers_only: "messages.errFollowersOnly",
  abuse_pattern: "messages.errAbuse",
  recipient_unavailable: "messages.errRecipient",
  invalid_share: "messages.errShare",
  share_unavailable: "messages.errShare",
  invalid_kind: "messages.errShare",
  challenge_not_open: "messages.errChallengeClosed",
  invalid_body: "messages.errGeneric",
  unauthenticated: "messages.needAccount",
};

function relTime(ts: number | undefined, lang: Lang): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return lang === "sq" ? "tani" : "now";
  if (min < 60) return lang === "sq" ? `${min}m` : `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return lang === "sq" ? `${h}h` : `${h}h`;
  return new Date(ts).toLocaleDateString();
}

/* ------------------------------ list page ------------------------------ */

export function MessagesPage() {
  const { t, lang } = useStore();
  const nav = useNavigate();
  const { sessionToken, viewer } = useAuth();

  const data = useQuery(
    api.messagingWire.listMyConversations,
    sessionToken ? { sessionToken } : "skip"
  );
  const serverConvos: ServerConvo[] =
    data && typeof data === "object" && "ok" in data && data.ok ? (data.conversations as ServerConvo[]) : [];
  const totalUnread = serverConvos.reduce((n, c) => n + c.unread, 0);

  if (sessionToken && viewer) {
    return (
      <Page>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800 }}>
            {t("messages.title")}
            {totalUnread > 0 && (
              <span className="chip active" style={{ marginLeft: 10, fontSize: 12, verticalAlign: "3px" }}>
                {t("notifications.unreadCount").replace("{n}", String(totalUnread))}
              </span>
            )}
          </h1>
          <button className="btn btn-primary btn-sm" onClick={() => nav("/messages/new")}>
            ✏️ {t("messages.newChat")}
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Densen Help — the assistant lives INSIDE Messages (Day 21). */}
          <button
            onClick={() => nav("/messages/help")}
            className="panel panel-hover"
            style={{
              display: "flex",
              gap: 13,
              padding: 13,
              alignItems: "center",
              cursor: "pointer",
              textAlign: "left",
              color: "inherit",
              width: "100%",
              borderColor: "var(--gold-line)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background: "linear-gradient(135deg, #f0c75e, var(--gold))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                flexShrink: 0,
              }}
            >
              🤖
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t("help.title")}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t("help.preview")}
              </div>
            </div>
            <span className="chip active" style={{ fontSize: 12 }}>AI</span>
          </button>
          {serverConvos.map((c) => (
            <button
              key={c.id}
              onClick={() => nav(`/messages/${c.id}`)}
              className="panel panel-hover"
              style={{
                display: "flex",
                gap: 13,
                padding: 13,
                alignItems: "center",
                cursor: "pointer",
                textAlign: "left",
                color: "inherit",
                width: "100%",
                borderColor: c.unread > 0 ? "var(--gold-line)" : undefined,
              }}
            >
              <Avatar src={c.otherAvatarUrl ?? IMG.extra1} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>
                    {c.otherDisplayName} <span className="faint" style={{ fontWeight: 500, fontSize: 12 }}>@{c.otherHandle}</span>
                  </span>
                  <span className="faint" style={{ fontSize: 11.5 }}>{relTime(c.lastMessageAt, lang)}</span>
                </div>
                <div className={c.unread > 0 ? "" : "muted"} style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2, fontWeight: c.unread > 0 ? 700 : 400 }}>
                  {c.guardianVisible && <span title={t("messages.guardianVisible")}>👁 </span>}
                  {c.blocked ? `🚫 ${t("messages.blocked")}` : c.muted ? `🔇 ${t("messages.muted")} · ` : ""}
                  {c.lastMessagePreview || (c.unread > 0 ? `✉️ ${t("messages.unread")}` : "")}
                </div>
              </div>
              {c.unread > 0 && <UnreadBadge n={c.unread} />}
            </button>
          ))}
        </div>
        {serverConvos.length === 0 && (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <Empty icon="✉️" text={t("messages.noResults")} />
            <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} onClick={() => nav("/messages/new")}>
              {t("messages.newChat")}
            </button>
          </div>
        )}
      </Page>
    );
  }

  return <PrototypeMessages />;
}

const UnreadBadge = ({ n }: { n: number }) => (
  <span
    style={{
      minWidth: 22,
      height: 22,
      padding: "0 7px",
      borderRadius: 999,
      background: "var(--gold)",
      color: "#171204",
      fontSize: 12,
      fontWeight: 800,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    }}
  >
    {n > 99 ? "99+" : n}
  </span>
);

/* ------------------------------ new chat / search ------------------------------ */

export function NewChatPage() {
  const { t } = useStore();
  const nav = useNavigate();
  const { sessionToken } = useAuth();
  const [q, setQ] = useState("");

  const data = useQuery(
    api.messagingWire.searchUsers,
    sessionToken && q.trim().length >= 2 ? { sessionToken, q: q.trim() } : "skip"
  );
  const results: { userId: string; handle: string; displayName: string; isPrivate: boolean }[] =
    data && typeof data === "object" && "ok" in data && data.ok ? (data.users as typeof results) : [];
  const denied = data && typeof data === "object" && "ok" in data && !data.ok;

  if (!sessionToken) {
    return (
      <Page>
        <Empty icon="🔐" text={t("messages.needAccount")} />
      </Page>
    );
  }

  return (
    <Page>
      <button onClick={() => nav("/messages")} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {t("common.back")}
      </button>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 16 }}>{t("messages.newChat")}</h1>
      <input
        className="input"
        placeholder={t("messages.searchUsers")}
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 6 }}
      />
      {q.trim().length > 0 && q.trim().length < 2 && (
        <p className="faint" style={{ fontSize: 12.5, margin: "0 2px 12px" }}>{t("messages.searchMin")}</p>
      )}
      {denied && <p className="faint" style={{ fontSize: 12.5, margin: "0 2px 12px" }}>{t("messages.searchMin")}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {results.map((u) => (
          <button
            key={u.userId}
            onClick={() => nav(`/messages/to/${u.userId}`)}
            className="panel panel-hover"
            style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
          >
            <Avatar size={42} src={IMG.extra1} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{u.displayName}</div>
              <div className="faint" style={{ fontSize: 12 }}>@{u.handle}{u.isPrivate ? ` · 🔒 ${t("messages.private")}` : ""}</div>
            </div>
            <span className="chip active" style={{ fontSize: 12 }}>{t("messages.startChat")}</span>
          </button>
        ))}
      </div>
      {q.trim().length >= 2 && results.length === 0 && !denied && <Empty icon="🔍" text={t("messages.noResults")} />}
    </Page>
  );
}

/* ------------------------------ chat view ------------------------------ */

export function ChatPage() {
  const { convId } = useParams();
  const nav = useNavigate();
  const { t, lang } = useStore();
  const gov = useGov();
  const { sessionToken } = useAuth();
  const serverBlock = useMutation(api.moderationWire.blockUser);
  const serverUnblock = useMutation(api.moderationWire.unblockUser);
  const serverMute = useMutation(api.moderationWire.muteUser);
  const serverUnmute = useMutation(api.moderationWire.unmuteUser);
  const serverSend = useMutation(api.messagingWire.sendMessage);
  const markRead = useMutation(api.messagingWire.markConversationRead);
  const [reportOpen, setReportOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const data = useQuery(
    api.messagingWire.getConversation,
    sessionToken && convId && convId !== "new" && !convId.startsWith("to/") ? { sessionToken, conversationId: convId } : "skip"
  );

  const shareData = useQuery(
    api.messagingWire.listShareableContent,
    sessionToken ? { sessionToken } : "skip"
  );
  const shareItems: { shareKind: string; ref: string; title: string; subtitle?: string }[] =
    shareData && typeof shareData === "object" && "ok" in shareData && shareData.ok
      ? (shareData.items as typeof shareItems)
      : [];

  const convo = data && typeof data === "object" && "ok" in data && data.ok ? (data.conversation as ServerConvo & { otherIsMinor: boolean }) : null;
  const serverMsgs: ServerMsg[] = data && typeof data === "object" && "ok" in data && data.ok ? (data.messages as ServerMsg[]) : [];

  // Server read cursor on open + when new messages arrive.
  useEffect(() => {
    if (sessionToken && convId && convo && serverMsgs.length > 0) {
      void markRead({ sessionToken, conversationId: convId }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, convId, convo?.id, serverMsgs.length]);

  // Prototype-path support (guests + direct /messages/cv1 links).
  const cv = conversations.find((c) => c.id === convId);
  const [text, setText] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [pendingShare, setPendingShare] = useState<{ ref: string; kind: string; title: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const msgs: ChatMessage[] = useMemo(() => {
    if (convo) {
      return serverMsgs.map((m) => ({
        id: m.id,
        from: (m.mine ? "me" : m.senderId) as string,
        text: m.body,
        attachment: m.shareKind
          ? {
              type: (m.attachmentType === "challenge" ? "challenge" : (m.attachmentType ?? "post")) as "lesson" | "post" | "video" | "choreo" | "challenge",
              title: m.attachmentTitle ?? t(SHARE_LABEL_KEYS[m.shareKind] as never),
              cover: IMG.extra1,
            }
          : undefined,
        time: relTime(m.createdAt, lang),
      })) as ChatMessage[];
    }
    if (!cv) return [];
    return cv.messages;
  }, [convo, serverMsgs, cv, lang, t]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  /* ---------- prototype path (guest) ---------- */
  if (!convo) {
    return <PrototypeChat convId={convId} reportOpen={reportOpen} setReportOpen={setReportOpen} />;
  }

  /* ---------- server path ---------- */
  const other = convo;
  const title = other.otherDisplayName;

  const doBlock = () => {
    gov.toggleBlock(other.otherUserId);
    if (sessionToken) {
      const turningOn = !gov.isBlocked(other.otherUserId);
      void (turningOn ? serverBlock({ sessionToken, targetUserId: other.otherUserId }) : serverUnblock({ sessionToken, targetUserId: other.otherUserId })).catch(() => undefined);
    }
    gov.toast(gov.isBlocked(other.otherUserId) ? t("gov.msg.unblocked") : t("gov.msg.blockedToast"));
  };
  const doMute = () => {
    gov.toggleMute(other.otherUserId);
    if (sessionToken) {
      const turningOn = !gov.isMuted(other.otherUserId);
      void (turningOn ? serverMute({ sessionToken, targetUserId: other.otherUserId }) : serverUnmute({ sessionToken, targetUserId: other.otherUserId })).catch(() => undefined);
    }
    gov.toast(gov.isMuted(other.otherUserId) ? t("gov.msg.unmuted") : t("gov.msg.muted"));
  };

  const send = () => {
    const body = text.trim();
    if ((!body && !pendingShare) || !sessionToken) return;
    setSendError(null);
    void serverSend({
      sessionToken,
      recipientId: other.otherUserId,
      body,
      shareKind: pendingShare ? (pendingShare.kind as never) : undefined,
      shareRef: pendingShare?.ref,
    })
      .then((res) => {
        if (res && typeof res === "object" && "ok" in res && res.ok) {
          setText("");
          setPendingShare(null);
        } else if (res && typeof res === "object" && "error" in res) {
          setSendError(t((ERROR_KEYS[res.error as string] ?? "messages.errGeneric") as never));
        }
      })
      .catch(() => setSendError(t("messages.errGeneric")));
  };

  return (
    <div className="anim-fade" style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--bg-soft)" }}>
        <button onClick={() => nav("/messages")} className="btn btn-icon btn-ghost btn-sm">←</button>
        <Avatar src={other.otherAvatarUrl ?? IMG.extra1} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>{title}</div>
          <div className="faint" style={{ fontSize: 12 }}>@{other.otherHandle}</div>
        </div>
        <button className="btn btn-icon btn-ghost btn-sm" onClick={() => nav(`/user/${other.otherUserId}`)} aria-label={t("nav.profile")}>👤</button>
      </div>

      {/* guardian visibility notice for minor threads */}
      {convo.guardianVisible && (
        <p className="faint" style={{ margin: 0, padding: "8px 16px", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
          👁 {t("messages.guardianVisible")}
        </p>
      )}

      {sendError && (
        <div style={{ padding: "10px 16px", background: "var(--gold-soft)", borderBottom: "1px solid var(--gold-line)" }} role="alert">
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>🛡 {sendError}</p>
        </div>
      )}

      {/* messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 860, width: "100%", margin: "0 auto" }}>
        {msgs.map((m) => {
          const mine = m.from === "me";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "78%",
                  background: mine ? "linear-gradient(135deg, #f0c75e, var(--gold))" : "var(--panel-2)",
                  color: mine ? "#171204" : "var(--ink)",
                  borderRadius: 18,
                  padding: "10px 14px",
                  borderBottomRightRadius: mine ? 6 : 18,
                  borderBottomLeftRadius: mine ? 18 : 6,
                }}
              >
                {m.attachment && (
                  <div
                    onClick={() => nav("/learn")}
                    style={{ borderRadius: 12, overflow: "hidden", marginBottom: m.text ? 8 : 0, cursor: "pointer", border: "1px solid rgba(255,255,255,0.15)", maxWidth: 240 }}
                  >
                    <div style={{ position: "relative", aspectRatio: "16/9" }}>
                      <img src={m.attachment.cover} alt="" className="media-cover" />
                    </div>
                    <div style={{ padding: "7px 10px", fontSize: 12, fontWeight: 700, background: "rgba(0,0,0,0.35)" }}>
                      {m.attachment.type === "challenge" ? "🏆" : "🎓"} {m.attachment.title}
                    </div>
                  </div>
                )}
                {m.text && <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</div>}
                <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 4, textAlign: "right" }}>{m.time}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* share sheet — REAL shareable content (published rows only) */}
      {shareOpen && (
        <div onClick={() => setShareOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,0.5)" }}>
          <div onClick={(e) => e.stopPropagation()} className="anim-rise panel" style={{ position: "absolute", bottom: 0, left: 0, right: 0, borderRadius: "22px 22px 0 0", padding: 16, maxHeight: "60dvh", overflowY: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>{t("messages.shareTitle")}</div>
            {shareItems.length === 0 && <p className="faint" style={{ fontSize: 13 }}>{t("messages.noResults")}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {shareItems.map((item) => (
                <button
                  key={`${item.shareKind}:${item.ref}`}
                  onClick={() => {
                    setPendingShare({ ref: item.ref, kind: item.shareKind, title: item.title });
                    setShareOpen(false);
                  }}
                  style={{ display: "flex", gap: 11, alignItems: "center", padding: 9, borderRadius: 12, background: "var(--bg-soft)", border: "1px solid var(--line)", cursor: "pointer", color: "inherit", textAlign: "left" }}
                >
                  <span style={{ width: 58, height: 40, borderRadius: 8, background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                    {item.shareKind === "challenge_invite" ? "🏆" : item.shareKind === "video" ? "🎬" : item.shareKind === "post" ? "🖼" : item.shareKind === "combo" || item.shareKind === "choreography" ? "💃" : "🎓"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
                    <span className="faint" style={{ display: "block", fontSize: 11.5 }}>
                      {t(SHARE_LABEL_KEYS[item.shareKind] as never)}{item.subtitle ? ` · ${item.subtitle}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* composer */}
      <div style={{ padding: "10px 16px calc(12px + var(--sab))", borderTop: "1px solid var(--line)", background: "var(--bg-soft)", display: "flex", gap: 10, maxWidth: 892, width: "100%", margin: "0 auto", alignItems: "center" }}>
        <button className="btn btn-icon btn-ghost" onClick={() => setReportOpen(true)} aria-label={t("settings.report")} title={t("settings.report")}>🚩</button>
        <button className="btn btn-icon btn-ghost" onClick={doBlock} aria-label={t("gov.msg.block")} title={t("gov.msg.block")}>🚫</button>
        <button className="btn btn-icon btn-ghost" onClick={doMute} aria-label={t("gov.msg.mute")} title={t("gov.msg.mute")}>🔇</button>
        <button className="btn btn-icon btn-ghost" onClick={() => setShareOpen(true)} aria-label={t("messages.share")} title={t("messages.share")}>📎</button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {pendingShare && (
            <span className="chip active" style={{ alignSelf: "flex-start", fontSize: 11, display: "flex", gap: 6, alignItems: "center", maxWidth: "100%" }}>
              {t("messages.shareSent")}: {pendingShare.title.slice(0, 30)}
              <button onClick={() => setPendingShare(null)} aria-label={t("common.cancel")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 800 }}>✕</button>
            </span>
          )}
          <input
            className="input"
            placeholder={convo.blocked ? t("messages.errBlocked") : t("messages.typePlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={convo.blocked}
            aria-disabled={convo.blocked}
          />
        </div>
        <button className="btn btn-primary btn-icon" onClick={send} aria-label={t("messages.send")} disabled={convo.blocked || (!text.trim() && !pendingShare)}>
          <IcSend size={18} />
        </button>
      </div>

      {reportOpen && <ReportModal open onClose={() => setReportOpen(false)} targetType="message" targetId={convo.id} targetLabel={title} />}
    </div>
  );
}

/* ---------------- Densen Help assistant (Day 21) ---------------- */

/** Projection of helpWire.getHelpConversation rows. */
interface HelpMsg {
  id: string;
  role: "user" | "assistant";
  text: string;
  answeredBy?: string;
  flags: string[];
  createdAt: number;
}

/** Client mirror of the help wire error vocabulary (server authoritative). */
const HELP_ERROR_KEYS: Record<string, string> = {
  rate_limited: "help.errRateLimited",
  assistant_not_configured: "help.errNotConfigured",
  assistant_disabled: "help.errDisabled",
  unauthenticated: "messages.needAccount",
};

/**
 * Messages → Densen Help 🤖. The assistant thread: server-configurable welcome,
 * deterministic FAQ answers, honest error mapping, and a "Thinking…" state
 * while the scheduled AI action lands its validated reply.
 */
export function HelpChatPage() {
  const nav = useNavigate();
  const { t, lang } = useStore();
  const { sessionToken } = useAuth();
  const ask = useMutation(api.helpWire.askHelp);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const cfg = useQuery(api.helpWire.helpConfig, sessionToken ? { sessionToken, lang } : "skip");
  const data = useQuery(api.helpWire.getHelpConversation, sessionToken ? { sessionToken } : "skip");

  const cfgOk = Boolean(cfg && typeof cfg === "object" && "ok" in cfg && cfg.ok);
  const enabled = cfgOk ? Boolean((cfg as { enabled: boolean }).enabled) : true;
  const welcome = cfgOk ? ((cfg as { welcome?: string }).welcome ?? "") : "";
  const maxLen = cfgOk ? ((cfg as { maxMessageLength?: number }).maxMessageLength ?? 1500) : 1500;
  const msgs: HelpMsg[] =
    data && typeof data === "object" && "ok" in data && data.ok ? (data.messages as HelpMsg[]) : [];
  // Waiting = the last row is the user's question and no assistant reply yet.
  const waiting = msgs.length > 0 && msgs[msgs.length - 1].role === "user";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, waiting]);

  if (!sessionToken) {
    return (
      <Page>
        <Empty icon="🔐" text={t("messages.needAccount")} />
      </Page>
    );
  }

  const send = (preset?: string) => {
    const body = (preset ?? text).trim();
    if (!body || !sessionToken || waiting) return;
    setError(null);
    void ask({ sessionToken, text: body, lang })
      .then((res) => {
        if (res && typeof res === "object" && "ok" in res && res.ok) {
          setText("");
        } else if (res && typeof res === "object" && "error" in res) {
          setError(t((HELP_ERROR_KEYS[res.error as string] ?? "help.errGeneric") as never));
        }
      })
      .catch(() => setError(t("help.errGeneric")));
  };

  if (!enabled) {
    return (
      <Page>
        <button onClick={() => nav("/messages")} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
          ← {t("common.back")}
        </button>
        <Empty icon="🤖" text={t("help.errDisabled")} />
      </Page>
    );
  }

  return (
    <div className="anim-fade" style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--bg-soft)" }}>
        <button onClick={() => nav("/messages")} className="btn btn-icon btn-ghost btn-sm">←</button>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 999,
            background: "linear-gradient(135deg, #f0c75e, var(--gold))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          🤖
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{t("help.title")}</div>
          <div className="faint" style={{ fontSize: 12 }}>{t("help.subtitle")}</div>
        </div>
        <span className="chip active" style={{ fontSize: 11 }}>AI</span>
      </div>

      {error && (
        <div style={{ padding: "10px 16px", background: "var(--gold-soft)", borderBottom: "1px solid var(--gold-line)" }} role="alert">
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>🛡 {error}</p>
        </div>
      )}

      {/* thread */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 860, width: "100%", margin: "0 auto" }}>
        {welcome && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ maxWidth: "85%", background: "var(--panel-2)", color: "var(--ink)", borderRadius: 18, borderBottomLeftRadius: 6, padding: "10px 14px" }}>
              <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{welcome}</div>
            </div>
          </div>
        )}
        {msgs.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {(["help.start1", "help.start2", "help.start3", "help.start4", "help.start5"] as const).map((k) => (
              <button key={k} className="chip" onClick={() => send(t(k))}>
                {t(k)}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m) => {
          const mine = m.role === "user";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "78%",
                  background: mine ? "linear-gradient(135deg, #f0c75e, var(--gold))" : "var(--panel-2)",
                  color: mine ? "#171204" : "var(--ink)",
                  borderRadius: 18,
                  padding: "10px 14px",
                  borderBottomRightRadius: mine ? 6 : 18,
                  borderBottomLeftRadius: mine ? 18 : 6,
                }}
              >
                <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</div>
                <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 4, textAlign: "right" }}>{relTime(m.createdAt, lang)}</div>
              </div>
            </div>
          );
        })}
        {waiting && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{ background: "var(--panel-2)", color: "var(--ink)", borderRadius: 18, borderBottomLeftRadius: 6, padding: "10px 14px" }}>
              <div className="faint" style={{ fontSize: 13 }}>{t("help.thinking")}</div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div style={{ padding: "10px 16px calc(12px + var(--sab))", borderTop: "1px solid var(--line)", background: "var(--bg-soft)", display: "flex", gap: 10, maxWidth: 892, width: "100%", margin: "0 auto", alignItems: "center" }}>
        <input
          className="input"
          placeholder={t("help.placeholder")}
          value={text}
          maxLength={maxLen}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          aria-label={t("help.title")}
        />
        <button className="btn btn-primary btn-icon" onClick={() => send()} aria-label={t("messages.send")} disabled={!text.trim() || waiting}>
          <IcSend size={18} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- direct-to-user composer (from search) ---------------- */

export function ComposeToUserPage() {
  const { userId } = useParams();
  const nav = useNavigate();
  const { t } = useStore();
  const { sessionToken } = useAuth();
  const serverSend = useMutation(api.messagingWire.sendMessage);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!sessionToken) {
    return (
      <Page>
        <Empty icon="🔐" text={t("messages.needAccount")} />
      </Page>
    );
  }

  const send = () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    void serverSend({ sessionToken, recipientId: userId!, body: text.trim() })
      .then((res) => {
        setSending(false);
        if (res && typeof res === "object" && "ok" in res && res.ok) {
          nav((res as { conversationId?: string }).conversationId ? `/messages/${(res as { conversationId: string }).conversationId}` : "/messages");
        } else if (res && typeof res === "object" && "error" in res) {
          setError(t((ERROR_KEYS[res.error as string] ?? "messages.errGeneric") as never));
        }
      })
      .catch(() => {
        setSending(false);
        setError(t("messages.errGeneric"));
      });
  };

  return (
    <Page>
      <button onClick={() => nav(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>← {t("common.back")}</button>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>{t("messages.startChat")}</h1>
      {error && (
        <div style={{ padding: "10px 14px", background: "var(--gold-soft)", borderRadius: 12, marginBottom: 12 }} role="alert">
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>🛡 {error}</p>
        </div>
      )}
      <input
        className="input"
        placeholder={t("messages.typePlaceholder")}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
      />
      <button className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={send} disabled={!text.trim() || sending}>
        {t("messages.send")}
      </button>
      <p className="faint" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
        🛡 {t("messages.guardianVisible")}
      </p>
    </Page>
  );
}

/* ============================================================================ */
/*                       Prototype paths (guest preview)                         */
/* ============================================================================ */

function PrototypeMessages() {
  const { t } = useStore();
  const nav = useNavigate();
  const [q, setQ] = useState("");

  const list = useMemo(
    () =>
      conversations.filter((c) => {
        const name = c.group ? c.name ?? "" : userById(c.participants[0]).name;
        return name.toLowerCase().includes(q.toLowerCase());
      }),
    [q]
  );

  const lastOf = (cv: (typeof conversations)[number]) => {
    const m = cv.messages[cv.messages.length - 1];
    return m.text ?? `📎 ${m.attachment?.title ?? ""}`;
  };

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("messages.title")}</h1>
        <button className="btn btn-primary btn-sm" onClick={() => nav("cv1")}>✏️ {t("messages.new")}</button>
      </div>
      <p className="faint" style={{ fontSize: 12, margin: "-8px 2px 14px" }}>
        {t("messages.needAccount")}
      </p>

      <input className="input" placeholder={t("messages.search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((cv) => {
          const u = userById(cv.participants[0]);
          return (
            <button
              key={cv.id}
              onClick={() => nav(`/messages/${cv.id}`)}
              className="panel panel-hover"
              style={{ display: "flex", gap: 13, padding: 13, alignItems: "center", cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
            >
              <div style={{ position: "relative" }}>
                {cv.group ? (
                  <div style={{ display: "flex" }}>
                    <Avatar src={userById(cv.participants[0]).avatar} size={44} />
                    <div style={{ marginLeft: -12 }}>
                      <Avatar src={userById(cv.participants[1]).avatar} size={44} />
                    </div>
                  </div>
                ) : (
                  <Avatar src={u.avatar} size={48} />
                )}
                {cv.online && <span style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: "50%", background: "#4ade80", border: "2px solid var(--bg)" }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>{cv.group ? cv.name : u.name}</span>
                  <span className="faint" style={{ fontSize: 11.5 }}>{cv.messages[cv.messages.length - 1].time}</span>
                </div>
                <div className="muted" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{lastOf(cv)}</div>
              </div>
            </button>
          );
        })}
      </div>
      {list.length === 0 && <Empty icon="✉️" text={t("notifications.empty")} />}
    </Page>
  );
}

function PrototypeChat({
  convId,
  reportOpen,
  setReportOpen,
}: {
  convId?: string;
  reportOpen: boolean;
  setReportOpen: (v: boolean) => void;
}) {
  const { t } = useStore();
  const nav = useNavigate();
  const { sentMessages, sendMessage, lang } = useStore();
  const gov = useGov();
  const cv = conversations.find((c) => c.id === convId);
  const [text, setText] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const msgs: ChatMessage[] = useMemo(() => {
    if (!cv) return [];
    const sent = (sentMessages[cv.id] ?? []).map((m, i) => ({
      id: `sent-${i}`,
      from: "me" as const,
      text: m.text,
      attachment: m.attachmentTitle
        ? {
            type: (m.attachmentType ?? "post") as "lesson" | "post" | "video" | "choreo",
            title: m.attachmentTitle,
            cover: m.attachmentCover ?? IMG.extra1,
          }
        : undefined,
      time: m.time,
    }));
    return [...cv.messages, ...sent];
  }, [cv, sentMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length]);

  if (!cv) return <Page><Empty icon="✉️" text="Conversation not found" /></Page>;

  const other = userById(cv.participants[0]);
  const title = cv.group ? cv.name ?? "Group" : other.name;

  /* ---- 40/43: messaging safety gate (client preview of the server rule) ---- */
  const myBandIsAdult = gov.ageBandValue === "adult";
  const check = canMessage({
    fromIsAdult: myBandIsAdult,
    fromIsVerifiedTeacher: false,
    toIsMinor: Boolean(other.minor),
    toPref: other.minor ? "none" : "everyone",
    followingBack: cv.online === true,
    isContact: true,
    isBlockedByEither: gov.isBlocked(other.id) || gov.isMuted(other.id),
  });
  const composerLocked = !check.allowed;

  const send = () => {
    if (!text.trim() || composerLocked) return;
    const level = gov.logContactAttempt({ from: "me", to: other.id, kind: "dm" });
    if (level === "restrict") gov.toast(t("gov.msg.contactFlag"));
    sendMessage(cv.id, { text: text.trim() });
    setText("");
  };

  return (
    <div className="anim-fade" style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--line)", background: "var(--bg-soft)" }}>
        <button onClick={() => nav("/messages")} className="btn btn-icon btn-ghost btn-sm">←</button>
        <Avatar src={other.avatar} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
            {title} {!cv.group && other.verified && <IcVerified />}
          </div>
          <div className="faint" style={{ fontSize: 12 }}>
            {cv.group ? `${cv.participants.length + 1} ${t("common.members")}` : cv.online ? `● ${t("messages.online")}` : t("messages.offline")}
          </div>
        </div>
        {!cv.group && <button className="btn btn-icon btn-ghost btn-sm" onClick={() => nav(`/user/${other.id}`)}>👤</button>}
      </div>

      {composerLocked && (
        <div style={{ padding: "10px 16px", background: "var(--gold-soft)", borderBottom: "1px solid var(--gold-line)" }} role="alert">
          <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>🛡 {t("gov.msg.gate")}</p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.6 }}>{check.reason ? tx(check.reason, lang) : t("gov.msg.gateSub")}</p>
        </div>
      )}
      {!composerLocked && check.guardianVisible && other.minor && (
        <p className="faint" style={{ margin: 0, padding: "8px 16px", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
          👁 {t("gov.msg.guardianVisible")}
        </p>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 16px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 860, width: "100%", margin: "0 auto" }}>
        {msgs.map((m) => {
          const mine = m.from === "me";
          return (
            <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "78%",
                  background: mine ? "linear-gradient(135deg, #f0c75e, var(--gold))" : "var(--panel-2)",
                  color: mine ? "#171204" : "var(--ink)",
                  borderRadius: 18,
                  padding: "10px 14px",
                  borderBottomRightRadius: mine ? 6 : 18,
                  borderBottomLeftRadius: mine ? 18 : 6,
                }}
              >
                {cv.group && !mine && (
                  <div className="faint" style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>{userById(m.from).name}</div>
                )}
                {m.attachment && (
                  <div
                    onClick={() => nav("/learn")}
                    style={{ borderRadius: 12, overflow: "hidden", marginBottom: m.text ? 8 : 0, cursor: "pointer", border: "1px solid rgba(255,255,255,0.15)", maxWidth: 240 }}
                  >
                    <div style={{ position: "relative", aspectRatio: "16/9" }}>
                      <img src={m.attachment.cover} alt="" className="media-cover" />
                    </div>
                    <div style={{ padding: "7px 10px", fontSize: 12, fontWeight: 700, background: "rgba(0,0,0,0.35)" }}>
                      🎓 {m.attachment.title}
                    </div>
                  </div>
                )}
                {m.text && <div style={{ fontSize: 14, lineHeight: 1.5 }}>{m.text}</div>}
                <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 4, textAlign: "right" }}>{m.time}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {shareOpen && (
        <div onClick={() => setShareOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,0.5)" }}>
          <div onClick={(e) => e.stopPropagation()} className="anim-rise panel" style={{ position: "absolute", bottom: 0, left: 0, right: 0, borderRadius: "22px 22px 0 0", padding: 16, maxHeight: "60dvh", overflowY: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>{t("messages.sharedLesson")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {courses.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { sendMessage(cv.id, { text: undefined, attachmentTitle: `${c.title} — ${c.lessons[0].title}`, attachmentType: "lesson", attachmentCover: c.cover }); setShareOpen(false); }}
                  style={{ display: "flex", gap: 11, alignItems: "center", padding: 9, borderRadius: 12, background: "var(--bg-soft)", border: "1px solid var(--line)", cursor: "pointer", color: "inherit", textAlign: "left" }}
                >
                  <img src={c.cover} alt="" style={{ width: 58, height: 40, borderRadius: 8, objectFit: "cover" }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: "10px 16px calc(12px + var(--sab))", borderTop: "1px solid var(--line)", background: "var(--bg-soft)", display: "flex", gap: 10, maxWidth: 892, width: "100%", margin: "0 auto" }}>
        <button className="btn btn-icon btn-ghost" onClick={() => setReportOpen(true)} aria-label={t("settings.report")} title={t("settings.report")}>🚩</button>
        <button className="btn btn-icon btn-ghost" onClick={() => { gov.toggleBlock(other.id); gov.toast(t("gov.msg.blockedToast")); }} aria-label={t("gov.msg.block")} title={t("gov.msg.block")}>🚫</button>
        <button className="btn btn-icon btn-ghost" onClick={() => { gov.toggleMute(other.id); gov.toast(t("gov.msg.muted")); }} aria-label={t("gov.msg.mute")} title={t("gov.msg.mute")}>🔇</button>
        <input
          className="input"
          placeholder={composerLocked ? t("gov.msg.gate") : t("messages.typePlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          style={{ flex: 1 }}
          disabled={composerLocked}
          aria-disabled={composerLocked}
        />
        <button className="btn btn-primary btn-icon" onClick={send} aria-label={t("messages.send")} disabled={composerLocked}>
          <IcSend size={18} />
        </button>
      </div>

      {reportOpen && <ReportModal open onClose={() => setReportOpen(false)} targetType="message" targetId={cv.id} targetLabel={title} />}
    </div>
  );
}

/* ============================================================================ */
/*                          Notifications (Day 16)                               */
/* ============================================================================ */

import { notifications as notifications0 } from "../data/store";

const kindIcon: Record<string, string> = {
  like: "❤️",
  follow: "👤",
  comment: "💬",
  challenge: "🏆",
  message: "✉️",
  progress: "📈",
  live: "🔴",
  duet: "🤝",
};

/** Guest prototype notifications (offline mirror). */
export function NotificationsPage() {
  const { t } = useStore();
  const [read, setRead] = useState<Set<string>>(new Set(notifications0.map((n) => (n.read ? n.id : ""))));

  const today = notifications0.filter((n) => !["Yesterday", "1d"].includes(n.time));
  const earlier = notifications0.filter((n) => ["Yesterday", "1d"].includes(n.time));

  const Row = ({ n }: { n: (typeof notifications0)[number] }) => {
    const actor = n.actorId ? userById(n.actorId) : undefined;
    const isRead = read.has(n.id);
    return (
      <button
        onClick={() => setRead((s) => new Set(s).add(n.id))}
        style={{
          display: "flex",
          gap: 13,
          alignItems: "center",
          width: "100%",
          padding: "13px 14px",
          borderRadius: 14,
          border: "1px solid var(--line)",
          background: isRead ? "transparent" : "var(--gold-soft)",
          cursor: "pointer",
          color: "inherit",
          textAlign: "left",
          marginBottom: 8,
        }}
      >
        {actor ? (
          <Avatar src={actor.avatar} size={42} />
        ) : (
          <span style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            {kindIcon[n.kind]}
          </span>
        )}
        <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>
          {actor && <strong>{actor.name} </strong>}
          {n.text}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 16 }}>{kindIcon[n.kind]}</span>
          <span className="faint" style={{ fontSize: 11 }}>{n.time}</span>
        </div>
      </button>
    );
  };

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("notifications.title")}</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => setRead(new Set(notifications0.map((n) => n.id)))}>
          ✓ {t("notifications.markAll")}
        </button>
      </div>

      {today.length > 0 && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{t("notifications.today")}</div>
          {today.map((n) => <Row key={n.id} n={n} />)}
        </>
      )}
      {earlier.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: "18px 0 10px" }}>{t("notifications.earlier")}</div>
          {earlier.map((n) => <Row key={n.id} n={n} />)}
        </>
      )}
      {notifications0.length === 0 && <Empty icon="🔔" text={t("notifications.empty")} />}
    </Page>
  );
}

/** Server notification row shape (notificationsWire.listMyNotifications). */
interface ServerNotif {
  id: string;
  type: string;
  category: string;
  targetType?: string;
  targetId?: string;
  read: boolean;
  createdAt: number;
  actor?: { handle?: string; displayName?: string; avatarUrl?: string } | null;
}

/** Route target for a notification (deep-links into the feature it came from). */
function notifRoute(n: ServerNotif): string | null {
  switch (n.targetType) {
    case "post":
      return n.targetId ? `/versions/${n.targetId}` : "/feed";
    case "challenge":
      return n.targetId ? `/challenge/${n.targetId}` : "/challenges";
    case "class":
      return n.targetId ? `/course/${n.targetId}` : "/learn";
    case "purchase":
      return "/settings";
    case "conversation":
      return "/messages";
    case "user":
      return n.targetId ? `/user/${n.targetId}` : "/profile";
    case "achievement":
      return "/progress";
    case "practice_item":
      return "/practice";
    default:
      return null;
  }
}

/** Signed-in: the REAL notification center — server rows, server read state. */
export function LiveNotifications() {
  const { t } = useStore();
  const { sessionToken, viewer } = useAuth();
  const nav = useNavigate();
  const markRead = useMutation(api.notificationsWire.markMyNotificationsRead);
  const data = useQuery(
    api.notificationsWire.listMyNotifications,
    sessionToken ? { sessionToken, limit: 80 } : "skip"
  );

  if (!sessionToken || !viewer) return null;

  const rows: ServerNotif[] =
    data && typeof data === "object" && "ok" in data && data.ok ? (data.notifications as ServerNotif[]) : [];
  const unread = rows.filter((n) => !n.read);

  const label = (n: ServerNotif) => {
    const key = `notif.live.${n.type}`;
    const text = t(key as never);
    return text === key ? t("notif.live.generic") : text;
  };

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>
          {t("notifications.title")}
          {unread.length > 0 && (
            <span className="chip active" style={{ marginLeft: 10, fontSize: 12, verticalAlign: "3px" }}>
              {t("notifications.unreadCount").replace("{n}", String(unread.length))}
            </span>
          )}
        </h1>
        {unread.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => void markRead({ sessionToken })}>
            ✓ {t("notifications.markAll")}
          </button>
        )}
      </div>
      <div className="eyebrow" style={{ marginBottom: 12 }}>🔔 {t("notifications.settings")}</div>

      {rows.map((n) => {
        const route = notifRoute(n);
        return (
          <button
            key={n.id}
            onClick={() => {
              if (!n.read) void markRead({ sessionToken, ids: [n.id] });
              if (route) nav(route);
            }}
            style={{
              display: "flex",
              gap: 13,
              alignItems: "center",
              width: "100%",
              padding: "13px 14px",
              borderRadius: 14,
              border: "1px solid var(--line)",
              background: n.read ? "transparent" : "var(--gold-soft)",
              cursor: "pointer",
              color: "inherit",
              textAlign: "left",
              marginBottom: 8,
            }}
          >
            {n.actor ? (
              <Avatar src={n.actor.avatarUrl ?? IMG.extra1} size={42} />
            ) : (
              <span style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                {n.category === "security" ? "🛡" : n.category === "purchases" ? "💳" : n.category === "achievements" ? "🏅" : n.category === "learning" ? "🎓" : n.category === "challenges" ? "🏆" : n.category === "messages" ? "✉️" : "🔔"}
              </span>
            )}
            <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>
              {n.actor?.displayName && <strong>{n.actor.displayName} </strong>}
              {label(n)}
            </div>
            <span className="faint" style={{ fontSize: 11 }}>{new Date(n.createdAt).toLocaleDateString()}</span>
            {!n.read && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", flexShrink: 0 }} />}
          </button>
        );
      })}
      {rows.length === 0 && (
        <p className="faint" style={{ textAlign: "center", marginTop: 24, fontSize: 13 }}>{t("notifications.empty")}</p>
      )}
    </Page>
  );
}

/** Route switch: live backend notifications when signed in, prototype otherwise. */
export function NotificationsRoute() {
  const { viewer } = useAuth();
  return viewer ? <LiveNotifications /> : <NotificationsPage />;
}
