import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, LevelBadge, Page } from "../components/ui";
import { IcPlay, IcSearch, IcVerified } from "../components/icons";
import { useStore } from "../state/store";
import { courses, fmt, hashtags, users } from "../data/store";

type Tab = "all" | "dancers" | "courses" | "challenges" | "hashtags" | "videos";

export default function Discover() {
  const { t, following, toggleFollow } = useStore();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [tab, setTab] = useState<Tab>("all");

  // Day 11 — live challenge catalog joins the discovery results.
  const serverChallenges = useQuery(api.challengesWire.listChallenges, {});
  const liveChallenges = useMemo(() => {
    if (!serverChallenges?.ok) return [];
    return (serverChallenges.challenges as {
      id: string;
      title: string;
      style?: string;
      phase: string;
      daysLeft: number;
      participantCount: number;
      hasCompleted: boolean;
    }[]).map((c) => ({
      id: c.id,
      title: c.title,
      style: c.style ?? "DENSEN",
      participants: c.participantCount,
      daysLeft: c.daysLeft,
      phase: c.phase,
      hasCompleted: c.hasCompleted,
    }));
  }, [serverChallenges]);

  const runSearch = (value: string) => setParams(value ? { q: value } : {});

  const res = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    const strip = s.replace("#", "");
    return {
      dancers: users.filter(
        (u) =>
          u.name.toLowerCase().includes(s) ||
          u.username.toLowerCase().includes(s) ||
          u.styles.some((x) => x.toLowerCase().includes(strip))
      ),
      teachers: users.filter((u) => u.teacher && (u.name.toLowerCase().includes(s) || u.styles.some((x) => x.toLowerCase().includes(strip)))),
      courses: courses.filter(
        (c) => c.title.toLowerCase().includes(s) || c.style.toLowerCase().includes(strip)
      ),
      challenges: liveChallenges.filter((c) => c.title.toLowerCase().includes(s) || c.style.toLowerCase().includes(strip)),
      tags: hashtags.filter((h) => h.tag.toLowerCase().includes(strip ? `#${strip}` : s)),
    };
  }, [q, liveChallenges]);

  const trending = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s) {
      return { dancers: res?.dancers ?? [], courses: res?.courses ?? [], challenges: res?.challenges ?? [] };
    }
    return {
      dancers: [...users].sort((a, b) => b.followers - a.followers).slice(0, 6),
      courses: courses.slice(0, 4),
      challenges: liveChallenges.filter((c) => c.phase === "active").slice(0, 3),
    };
  }, [q, res, liveChallenges]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: t("discover.all") },
    { id: "dancers", label: t("discover.dancers") },
    { id: "courses", label: t("discover.courses") },
    { id: "challenges", label: t("nav.challenges") },
    { id: "hashtags", label: t("discover.hashtags") },
    { id: "videos", label: t("discover.videos") },
  ];

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 14 }}>{t("discover.title")}</h1>

      <div style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}>
          <IcSearch />
        </span>
        <input
          className="input"
          placeholder={t("discover.searchPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch(input)}
          style={{ paddingLeft: 42 }}
        />
        {q && (
          <button
            onClick={() => { setInput(""); runSearch(""); }}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--ink-faint)", fontSize: 18, cursor: "pointer" }}
          >
            ✕
          </button>
        )}
      </div>

      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 20 }}>
        {tabs.map((tb) => (
          <button key={tb.id} className={`chip${tab === tb.id ? " active" : ""}`} onClick={() => setTab(tb.id)}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* suggested chips when idle */}
      {!q && tab === "all" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          {["Hip Hop", "Commercial", "Contemporary", "Salsa", "Jazz", "beginners"].map((s) => (
            <button key={s} className="chip" onClick={() => { setInput(s); runSearch(s); }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {(tab === "all" || tab === "dancers") && (trending.dancers.length > 0 || !!q) && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>
            {q ? t("discover.dancers") : t("discover.trendingDancers")}
          </h2>
          {trending.dancers.length === 0 ? (
            <p className="muted" style={{ fontSize: 14 }}>{t("discover.noResults")} "{q}"</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
              {trending.dancers.map((u) => (
                <div key={u.id} className="panel panel-hover" style={{ padding: 15, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8 }}>
                  <button onClick={() => nav(`/user/${u.id}`)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                    <Avatar src={u.avatar} size={62} ring={u.teacher} />
                  </button>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 5, justifyContent: "center" }}>
                      {u.name} {u.verified && <IcVerified />}
                    </div>
                    <div className="faint" style={{ fontSize: 12 }}>@{u.username} · {fmt(u.followers)} {t("profile.followers")}</div>
                  </div>
                  {u.id !== "me" && (
                    <button className={`btn btn-sm ${following.has(u.id) ? "" : "btn-primary"}`} style={{ width: "100%" }} onClick={() => toggleFollow(u.id)}>
                      {following.has(u.id) ? t("common.following") : t("common.follow")}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {(tab === "all" || tab === "courses") && trending.courses.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>{q ? t("discover.courses") : t("discover.popularClasses")}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {trending.courses.map((c) => (
              <button
                key={c.id}
                onClick={() => nav(`/course/${c.id}`)}
                className="panel panel-hover"
                style={{ textAlign: "left", padding: 0, overflow: "hidden", cursor: "pointer", color: "inherit" }}
              >
                <div style={{ position: "relative", aspectRatio: "16/9" }}>
                  <img src={c.cover} alt="" className="media-cover" loading="lazy" />
                  <span style={{ position: "absolute", right: 8, bottom: 8, background: "rgba(10,12,16,0.75)", borderRadius: 8, padding: "3px 8px", fontSize: 11, fontWeight: 700 }}>
                    ★ {c.rating}
                  </span>
                </div>
                <div style={{ padding: "11px 13px" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.title}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                    <LevelBadge level={c.level} /> {c.lessons.length} {t("learn.lessons")}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {(tab === "all" || tab === "challenges") && trending.challenges.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>{q ? t("nav.challenges") : t("discover.trendingChallenges")}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {trending.challenges.map((ch) => (
              <button
                key={ch.id}
                onClick={() => nav(`/challenge/${ch.id}`)}
                className="panel panel-hover"
                style={{ display: "flex", gap: 13, padding: 12, alignItems: "center", cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
              >
                <span style={{ width: 76, height: 58, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, background: "linear-gradient(135deg, var(--gold-line), var(--panel-2))", opacity: 0.85 }}>
                  🏁
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{ch.title}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                    🔥 {fmt(ch.participants)} {t("challenges.participants")} · {ch.phase === "active" && ch.daysLeft > 0 ? `${ch.daysLeft} ${t("challenges.daysLeft")}` : ch.phase}
                  </div>
                </div>
                <IcPlay size={16} />
              </button>
            ))}
          </div>
        </section>
      )}

      {(tab === "all" || tab === "hashtags") && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>{t("discover.hashtags")}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
            {hashtags
              .filter((h) => !q || h.tag.toLowerCase().includes(q.toLowerCase().replace("#", "")))
              .map((h) => (
                <button
                  key={h.tag}
                  className="panel panel-hover"
                  onClick={() => { setInput(h.tag); runSearch(h.tag); }}
                  style={{ padding: "13px 15px", textAlign: "left", cursor: "pointer", color: "inherit", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span style={{ fontWeight: 800, color: "var(--gold)", fontSize: 14 }}>{h.tag}</span>
                  <span className="faint" style={{ fontSize: 12 }}>{fmt(h.posts)} {t("discover.videos")}</span>
                </button>
              ))}
          </div>
        </section>
      )}

      {tab === "videos" && (
        <p className="muted" style={{ textAlign: "center", padding: "30px 0" }}>
          {t("feed.forYou")} → <button className="btn btn-sm btn-primary" onClick={() => nav("/")}>Open feed</button>
        </p>
      )}
    </Page>
  );
}
