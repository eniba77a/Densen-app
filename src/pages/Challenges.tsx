import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Empty, Page } from "../components/ui";
import { IcPlay, IcTrophy } from "../components/icons";
import { useStore } from "../state/store";
import { challenges, courseById, fmt, userById } from "../data/store";
import type { Challenge } from "../data/store";

/* ---------------- list ---------------- */
export function ChallengesPage() {
  const { t, joinedChallenges } = useStore();
  const nav = useNavigate();
  const [tab, setTab] = useState<"active" | "upcoming" | "ended">("active");

  const list = challenges.filter((c) => c.status === tab);

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{t("challenges.title")}</h1>
      <p className="muted" style={{ margin: "0 0 20px", fontSize: 14 }}>{t("challenges.subtitle")}</p>

      <div className="seg gold" style={{ marginBottom: 20 }}>
        {(["active", "upcoming", "ended"] as const).map((s) => (
          <button key={s} className={tab === s ? "active" : ""} onClick={() => setTab(s)}>
            {t(`challenges.${s}` as never)}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
        {list.map((ch) => {
          const joined = joinedChallenges.has(ch.id);
          return (
            <button
              key={ch.id}
              onClick={() => nav(`/challenge/${ch.id}`)}
              className="panel panel-hover"
              style={{ textAlign: "left", padding: 0, overflow: "hidden", cursor: "pointer", color: "inherit", position: "relative" }}
            >
              <div style={{ position: "relative", aspectRatio: "16/9" }}>
                <img src={ch.cover} alt="" className="media-cover" loading="lazy" />
                <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.7))" }} />
                <span className="chip" style={{ position: "absolute", top: 10, left: 10, background: "rgba(10,12,16,0.75)", fontSize: 11 }}>
                  {ch.style}
                </span>
                {ch.daysLeft > 0 && ch.status === "active" && (
                  <span style={{ position: "absolute", bottom: 10, right: 10, background: "var(--gold)", color: "#131007", fontWeight: 800, fontSize: 11, padding: "4px 10px", borderRadius: 999 }}>
                    ⏳ {ch.daysLeft} {t("challenges.daysLeft")}
                  </span>
                )}
              </div>
              <div style={{ padding: "13px 15px 15px" }}>
                <div style={{ fontWeight: 800, fontFamily: "Sora", fontSize: 15.5, marginBottom: 5 }}>{ch.title}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  🔥 {fmt(ch.participants)} {t("challenges.participants")} · {ch.deadline}
                </div>
                {joined && (
                  <span className="chip active" style={{ marginTop: 10, fontSize: 11.5 }}>✓ {t("challenges.joined")}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {list.length === 0 && <Empty icon="🏁" text={t("notifications.empty")} />}
    </Page>
  );
}

/* ---------------- detail ---------------- */
export function ChallengeDetail() {
  const { challengeId } = useParams();
  const nav = useNavigate();
  const { t, joinedChallenges, joinChallenge, toast } = useStore();
  const ch = challengeId ? challenges.find((c) => c.id === challengeId) : undefined;

  if (!ch) return <Page><Empty icon="🔍" text="Challenge not found" /></Page>;

  const joined = joinedChallenges.has(ch.id);
  const tutorial = courseById(ch.tutorialCourseId);
  const choreographer = userById(ch.featuredChoreoBy);
  const sorted = [...ch.entries].sort((a, b) => b.votes - a.votes);

  return (
    <Page>
      <button onClick={() => nav("/challenges")} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {t("nav.challenges")}
      </button>

      {/* hero */}
      <div style={{ position: "relative", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 18 }}>
        <img src={ch.cover} alt="" style={{ width: "100%", aspectRatio: "21/9", objectFit: "cover", display: "block" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, rgba(11,13,16,0.9))" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 18 }}>
          <span className="eyebrow">{ch.style} · {ch.deadline}</span>
          <h1 style={{ fontSize: "clamp(22px, 4.5vw, 32px)", fontWeight: 800, margin: "6px 0" }}>{ch.title}</h1>
          <div className="muted" style={{ fontSize: 13.5 }}>
            🔥 {fmt(ch.participants)} {t("challenges.participants")}
            {ch.daysLeft > 0 && ch.status === "active" && <> · ⏳ {ch.daysLeft} {t("challenges.daysLeft")}</>}
          </div>
        </div>
      </div>

      <p className="muted" style={{ lineHeight: 1.65, fontSize: 14.5, margin: "0 0 20px" }}>{ch.desc}</p>

      {/* actions */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {!joined ? (
          <button className="btn btn-primary" style={{ flex: 1, minWidth: 180 }} onClick={() => { joinChallenge(ch.id); toast("+100 XP · " + t("challenges.joined")); }}>
            <IcTrophy size={18} /> {t("challenges.join")}
          </button>
        ) : (
          <>
            <button className="btn btn-primary" style={{ flex: 1, minWidth: 180 }} onClick={() => nav(`/create?challenge=${ch.id}`)}>
              🎥 {t("challenges.submitVideo")}
            </button>
            <span className="chip active" style={{ alignSelf: "center", padding: "10px 16px" }}>✓ {t("challenges.joined")}</span>
          </>
        )}
        {tutorial && (
          <button className="btn" onClick={() => nav(`/course/${tutorial.id}`)}>
            🎓 {t("challenges.tutorial")}
          </button>
        )}
      </div>

      {/* featured choreography */}
      <div className="panel" style={{ padding: 15, display: "flex", gap: 13, alignItems: "center", marginBottom: 24, borderColor: "var(--gold-line)" }}>
        <Avatar src={choreographer.avatar} size={48} ring />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 3 }}>{t("challenges.featuredChoreo")}</div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>@{choreographer.username}</div>
          <div className="faint" style={{ fontSize: 12.5 }}>{choreographer.styles.join(" · ")}</div>
        </div>
        <button className="btn btn-sm" onClick={() => nav(`/user/${choreographer.id}`)}>Profile</button>
      </div>

      {/* prizes */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>🏆 {t("challenges.prize")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ch.prizes.map((p) => (
            <span key={p} className="chip">{p}</span>
          ))}
        </div>
      </section>

      {/* leaderboard */}
      {sorted.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>📊 {t("challenges.leaderboard")}</h2>
          <div className="panel" style={{ padding: "6px 14px" }}>
            {sorted.map((e, i) => {
              const u = userById(e.userId);
              return (
                <button
                  key={e.userId + i}
                  onClick={() => nav(`/user/${u.id}`)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", color: "inherit", textAlign: "left" }}
                >
                  <span style={{ width: 26, fontWeight: 800, fontFamily: "Sora", color: i < 3 ? "var(--gold)" : "var(--ink-faint)", fontSize: 14 }}>
                    {i + 1}
                  </span>
                  <Avatar src={u.avatar} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u.name}</div>
                    <div className="faint" style={{ fontSize: 11.5 }}>@{u.username}</div>
                  </div>
                  <span className="gold-text" style={{ fontWeight: 800, fontSize: 13 }}>{fmt(e.votes)} ♥</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* entries */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>🎥 {t("challenges.entries")}</h2>
        {ch.entries.length === 0 ? (
          <Empty icon="🎬" text={t("challenges.submitVideo")} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {ch.entries.map((e, i) => {
              const u = userById(e.userId);
              const post = e.postId;
              return (
                <button
                  key={i}
                  onClick={() => nav("/")}
                  className="panel panel-hover"
                  style={{ position: "relative", aspectRatio: "9/14", borderRadius: 14, overflow: "hidden", padding: 0, cursor: "pointer", border: "1px solid var(--line)", background: "var(--panel-2)" }}
                  title={post}
                >
                  <span style={{ position: "absolute", left: 8, bottom: 8, right: 8, fontWeight: 700, fontSize: 11.5, textShadow: "0 1px 6px rgba(0,0,0,0.9)", textAlign: "left" }}>
                    @{u.username}
                  </span>
                  <span style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "2px 7px", fontSize: 10.5, fontWeight: 700 }}>
                    ♥ {fmt(e.votes)}
                  </span>
                  <IcPlay size={22} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </Page>
  );
}

export type { Challenge };
