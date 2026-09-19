import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Empty, Page } from "../components/ui";
import { IcSend, IcVerified } from "../components/icons";
import { useStore } from "../state/store";
import { conversations, courses, userById } from "../data/store";
import type { ChatMessage } from "../data/store";
import { IMG } from "../data/media";
import { useGov } from "../state/governance";
import { ReportModal, tx } from "../components/gov-ui";
import { canMessage } from "../data/safety";

/* ---------------- conversation list ---------------- */
export function MessagesPage() {
  const { t, sentMessages } = useStore();
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
    const sent = sentMessages[cv.id] ?? [];
    if (sent.length > 0) {
      const last = sent[sent.length - 1];
      return last.text ?? `📎 ${last.attachmentTitle ?? ""}`;
    }
    const m = cv.messages[cv.messages.length - 1];
    return m.text ?? `📎 ${m.attachment?.title ?? ""}`;
  };

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("messages.title")}</h1>
        <button className="btn btn-primary btn-sm" onClick={() => nav("/messages/cv1")}>✏️ {t("messages.new")}</button>
      </div>

      <input className="input" placeholder={t("messages.search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 16 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((cv) => {
          const u = userById(cv.participants[0]);
          const last = lastOf(cv);
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
                  <span className="faint" style={{ fontSize: 11.5 }}>
                    {cv.messages[cv.messages.length - 1].time}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
                  {last}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {list.length === 0 && <Empty icon="✉️" text={t("notifications.empty")} />}
    </Page>
  );
}

/* ---------------- chat view ---------------- */
export function ChatPage() {
  const { convId } = useParams();
  const nav = useNavigate();
  const { t, sentMessages, sendMessage } = useStore();
  const gov = useGov();
  const [reportOpen, setReportOpen] = useState(false);
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

  /* ---- 40/43: messaging safety gate ---- */
  const myBandIsAdult = gov.ageBandValue === "adult";
  const check = canMessage({
    fromIsAdult: myBandIsAdult,
    fromIsVerifiedTeacher: false, // I am the sender in this prototype
    toIsMinor: Boolean(other.minor),
    toPref: other.minor ? "none" : "everyone",
    followingBack: cv.online === true, // prototype proxy: existing connection
    isContact: true, // an existing conversation implies prior contact
    isBlockedByEither: gov.isBlocked(other.id) || gov.isMuted(other.id),
  });
  const composerLocked = !check.allowed;

  const send = () => {
    if (!text.trim() || composerLocked) return;
    const level = gov.logContactAttempt({ from: "me", to: other.id, kind: "dm" });
    if (level === "restrict") {
      gov.toast(`${t("gov.msg.contactFlag")}`);
    }
    sendMessage(cv.id, { text: text.trim() });
    setText("");
  };

  return (
    <div className="anim-fade" style={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* header */}
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
        {!cv.group && (
          <button className="btn btn-icon btn-ghost btn-sm" onClick={() => nav(`/user/${other.id}`)}>👤</button>
        )}
      </div>

      {/* messages */}
      {composerLocked && (
        <div style={{ padding: "10px 16px", background: "var(--gold-soft)", borderBottom: "1px solid var(--gold-line)" }} role="alert">
          <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>🛡 {t("gov.msg.gate")}</p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.6 }}>{check.reason ? tx(check.reason, useStoreLang()) : t("gov.msg.gateSub")}</p>
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

      {/* share sheet */}
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

      {/* composer — locked when the safety gate says no */}
      <div style={{ padding: "10px 16px calc(12px + var(--sab))", borderTop: "1px solid var(--line)", background: "var(--bg-soft)", display: "flex", gap: 10, maxWidth: 892, width: "100%", margin: "0 auto" }}>
        <button className="btn btn-icon btn-ghost" onClick={() => setReportOpen(true)} aria-label={t("settings.report")} title={t("settings.report")}>🚩</button>
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => { gov.toggleBlock(other.id); gov.toast(gov.isBlocked(other.id) ? t("gov.msg.unblocked") : t("gov.msg.blockedToast")); }}
          aria-label={t("gov.msg.block")}
          title={t("gov.msg.block")}
        >
          🚫
        </button>
        <button
          className="btn btn-icon btn-ghost"
          onClick={() => { gov.toggleMute(other.id); gov.toast(gov.isMuted(other.id) ? t("gov.msg.unmuted") : t("gov.msg.muted")); }}
          aria-label={t("gov.msg.mute")}
          title={t("gov.msg.mute")}
        >
          🔇
        </button>
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

function useStoreLang() {
  return useStore().lang;
}

/* ---------------- notifications ---------------- */
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

import { notifications as notifications0 } from "../data/store";

/* ============================================================================
   Day-3 backend-backed notifications (live when signed in with Convex).
   Identity via session token; rows are non-PII; actor fields resolve through
   public profile projections only. Falls back to the prototype feed above
   for guests/offline preview — the same page serves both worlds honestly.
   ========================================================================== */
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useAuth } from "../state/auth";

export function LiveNotifications() {
  const { t } = useStore();
  const { sessionToken, viewer } = useAuth();
  const markRead = useMutation(api.content.markNotificationsRead);
  const data = useQuery(
    api.content.listNotifications,
    sessionToken ? { sessionToken } : "skip"
  );

  if (!sessionToken || !viewer) return null;

  const rows = (data && typeof data === "object" && "ok" in data && data.ok ? data.notifications : []) as
    | { id: string; type: string; read: boolean; createdAt: number; actor?: { displayName?: string; handle?: string } | null }[]
    | never[];
  const unread = rows.filter((n) => !n.read);

  const kindText: Record<string, string> = {
    comment: t("notif.live.comment"),
    follow: t("notif.live.follow"),
    message: t("notif.live.message"),
    reaction: t("notif.live.reaction"),
  };

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("notifications.title")}</h1>
        {unread.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => markRead({ sessionToken })}>
            ✓ {t("notifications.markAll")}
          </button>
        )}
      </div>
      {rows.map((n) => (
        <button
          key={n.id}
          style={{
            display: "flex",
            gap: 13,
            alignItems: "center",
            width: "100%",
            padding: "13px 14px",
            borderRadius: 14,
            border: "1px solid var(--line)",
            background: n.read ? "transparent" : "var(--gold-soft)",
            cursor: "default",
            color: "inherit",
            textAlign: "left",
            marginBottom: 8,
          }}
        >
          <span style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--panel-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
            {kindText[n.type] ? "🔔" : "🔔"}
          </span>
          <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>
            {n.actor?.displayName && <strong>{n.actor.displayName} </strong>}
            {kindText[n.type] ?? t("notif.live.generic")}
          </div>
          <span className="faint" style={{ fontSize: 11 }}>{new Date(n.createdAt).toLocaleDateString()}</span>
        </button>
      ))}
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
