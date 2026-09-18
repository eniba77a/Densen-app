import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Page } from "../components/ui";
import { IcCalendar, IcMapPin, IcPlay, IcUsers } from "../components/icons";
import { useStore } from "../state/store";
import { events, fmt, leaderboardCategory, liveClasses, userById } from "../data/store";
import type { TKey } from "../i18n";

/* ---------------- events ---------------- */
export function EventsPage() {
  const { t, registeredEvents, toggleRegister, toast } = useStore();
  const nav = useNavigate();

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{t("events.title")}</h1>
      <p className="muted" style={{ margin: "0 0 22px", fontSize: 14 }}>{t("events.subtitle")}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {events.map((e) => {
          const reg = registeredEvents.has(e.id);
          const host = userById(e.hostId);
          return (
            <div key={e.id} className="panel panel-hover" style={{ overflow: "hidden" }}>
              <div style={{ position: "relative", aspectRatio: "21/8" }}>
                <img src={e.cover} alt="" className="media-cover" loading="lazy" />
                <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 20%, rgba(11,13,16,0.85))" }} />
                <span className="chip" style={{ position: "absolute", top: 12, left: 12, background: "rgba(10,12,16,0.8)", fontSize: 11 }}>
                  {e.type}
                </span>
                {e.online && (
                  <span className="chip" style={{ position: "absolute", top: 12, right: 12, background: "rgba(10,12,16,0.8)", fontSize: 11 }}>
                    🌐 {t("events.online")}
                  </span>
                )}
              </div>
              <div style={{ padding: 16 }}>
                <h2 style={{ fontSize: 18, marginBottom: 6 }}>{e.title}</h2>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "var(--ink-dim)", marginBottom: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IcCalendar size={15} /> {e.date} · {e.time}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IcMapPin size={15} /> {e.location}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IcUsers size={15} /> {fmt(e.participants)} {t("events.participants")}</span>
                </div>
                <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, margin: "0 0 12px" }}>{e.desc}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <button onClick={() => nav(`/user/${host.id}`)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}>
                    <Avatar src={host.avatar} size={30} />
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t("events.host")}: {host.name}</span>
                  </button>
                  <div style={{ flex: 1 }} />
                  {e.spotsLeft !== undefined && (
                    <span className="faint" style={{ fontSize: 12 }}>{e.spotsLeft} {t("events.spots")}</span>
                  )}
                  <button
                    className={`btn btn-sm ${reg ? "" : "btn-primary"}`}
                    onClick={() => { toggleRegister(e.id); toast(reg ? "—" : `✓ ${e.title}`); }}
                  >
                    {reg ? `✓ ${t("events.registered")}` : t("events.register")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Page>
  );
}

/* ---------------- live ---------------- */
export function LivePage() {
  const { t, toast } = useStore();
  const [notified, setNotified] = useState<Set<string>>(new Set());
  const liveNow = liveClasses.find((l) => l.live);

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 22 }}>{t("live.title")}</h1>

      {liveNow && (
        <>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
            <span className="live-dot" /> {t("live.now")}
          </div>
          <div className="panel" style={{ overflow: "hidden", marginBottom: 28 }}>
            <div style={{ position: "relative", aspectRatio: "16/8" }}>
              <img src={liveNow.cover} alt="" className="media-cover" />
              <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.75))" }} />
              <span className="chip" style={{ position: "absolute", top: 12, left: 12, background: "rgba(0,0,0,0.7)", fontSize: 11 }}>
                <span className="live-dot" /> LIVE · {fmt(liveNow.viewers ?? 0)} {t("live.viewers")}
              </span>
              <div style={{ position: "absolute", left: 16, bottom: 14, right: 16 }}>
                <div style={{ fontWeight: 800, fontFamily: "Sora", fontSize: 18 }}>{liveNow.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>{userById(liveNow.teacherId).name} · {liveNow.style}</div>
              </div>
            </div>
            <div style={{ padding: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => toast("🔴 " + t("live.join") + " — " + liveNow.title)}>
                <IcPlay size={16} /> {t("live.join")}
              </button>
            </div>
          </div>
        </>
      )}

      <h2 style={{ fontSize: 18, marginBottom: 14 }}>{t("live.upcoming")}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {liveClasses.filter((l) => !l.live).map((l) => {
          const teacher = userById(l.teacherId);
          const isNotified = notified.has(l.id);
          return (
            <div key={l.id} className="panel" style={{ display: "flex", gap: 13, padding: 13, alignItems: "center" }}>
              <div style={{ position: "relative", width: 104, aspectRatio: "16/10", borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
                <img src={l.cover} alt="" className="media-cover" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{l.title}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                  {teacher.name} · {l.style}
                </div>
                <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>🕐 {l.startsIn}</div>
              </div>
              <button
                className={`btn btn-sm ${isNotified ? "" : "btn-primary"}`}
                onClick={() => setNotified((s) => new Set(s).add(l.id))}
              >
                {isNotified ? `🔔 ${t("live.notified")}` : t("live.notify")}
              </button>
            </div>
          );
        })}
      </div>
    </Page>
  );
}

/* ---------------- leaderboards ---------------- */
type LbCat = "dancers" | "creators" | "improved" | "challenge" | "consistent" | "teachers";

export function LeaderboardsPage() {
  const { t } = useStore();
  const nav = useNavigate();
  const [cat, setCat] = useState<LbCat>("dancers");
  const [period, setPeriod] = useState<"Weekly" | "Monthly" | "AllTime">("Weekly");

  const cats: { id: LbCat; label: string }[] = [
    { id: "dancers", label: t("leaderboards.topDancers") },
    { id: "creators", label: t("leaderboards.topCreators") },
    { id: "improved", label: t("leaderboards.mostImproved") },
    { id: "challenge", label: t("leaderboards.challengeLeaders") },
    { id: "consistent", label: t("leaderboards.mostConsistent") },
    { id: "teachers", label: t("leaderboards.topTeachers") },
  ];

  const periodLabel: Record<string, TKey> = { Weekly: "leaderboards.weekly", Monthly: "leaderboards.monthly", AllTime: "leaderboards.allTime" };
  const rows = leaderboardCategory(cat, period === "AllTime" ? "All Time" : period);

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{t("leaderboards.title")}</h1>
      <p className="muted" style={{ margin: "0 0 20px", fontSize: 14 }}>{t("leaderboards.subtitle")}</p>

      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
        {cats.map((c) => (
          <button key={c.id} className={`chip${cat === c.id ? " active" : ""}`} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="seg" style={{ marginBottom: 18 }}>
        {(["Weekly", "Monthly", "AllTime"] as const).map((p) => (
          <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
            {t(periodLabel[p])}
          </button>
        ))}
      </div>

      <div className="panel" style={{ padding: "6px 16px" }}>
        {rows.map((r, i) => {
          const u = userById(r.userId);
          const isMe = u.id === "me";
          return (
            <button
              key={r.userId + i}
              onClick={() => nav(`/user/${u.id}`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                width: "100%",
                padding: "12px 0",
                background: "none",
                border: "none",
                borderBottom: "1px solid var(--line)",
                cursor: "pointer",
                color: "inherit",
                textAlign: "left",
                opacity: 1,
              }}
            >
              <span
                style={{
                  width: 30,
                  fontWeight: 800,
                  fontFamily: "Sora",
                  fontSize: 15,
                  color: i === 0 ? "var(--gold)" : i < 3 ? "#d8c27a" : "var(--ink-faint)",
                }}
              >
                {i + 1}
              </span>
              <Avatar src={u.avatar} size={40} ring={i === 0} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {isMe ? t("leaderboards.you") : u.name}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>{r.metric}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="gold-text" style={{ fontWeight: 800, fontSize: 13.5 }}>{fmt(r.xp)} XP</div>
                <div style={{ fontSize: 11, color: r.delta.startsWith("+") ? "#4ade80" : "#f87171" }}>{r.delta}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Page>
  );
}
