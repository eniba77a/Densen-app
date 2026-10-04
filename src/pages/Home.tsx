import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bar } from "../components/ui";
import { IcFlame, IcPlay, IcSparkles } from "../components/icons";
import { useStore } from "../state/store";
import { courses, fmt } from "../data/store";
import { IMG, VID } from "../data/media";
import type { TKey } from "../i18n";

function CourseCard({ id }: { id: string }) {
  const nav = useNavigate();
  const { t, courseProgress } = useStore();
  const c = courses.find((x) => x.id === id)!;
  const pct = courseProgress(c.id);
  return (
    <button
      onClick={() => nav(`/course/${c.id}`)}
      className="panel panel-hover"
      style={{
        flex: "0 0 250px",
        scrollSnapAlign: "start",
        textAlign: "left",
        padding: 0,
        overflow: "hidden",
        cursor: "pointer",
        color: "inherit",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "16/10", background: "var(--panel-2)" }}>
        <img src={c.cover} alt="" className="media-cover" loading="lazy" />
        <span className="chip" style={{ position: "absolute", top: 10, left: 10, fontSize: 11, padding: "4px 10px", background: "rgba(10,12,16,0.7)" }}>
          {c.style}
        </span>
        <span
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            background: "rgba(10,12,16,0.75)",
            borderRadius: 8,
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <IcPlay size={10} /> {c.lessons.length} {t("learn.lessons")}
        </span>
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>{c.title}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {c.teacherId === "u_sara" ? "Sara K." : c.teacherId === "u_alex" ? "Alex D." : c.teacherId === "u_maria" ? "Maria E." : c.teacherId === "u_kejsi" ? "Kejsi T." : c.teacherId === "u_denisa" ? "Denisa H." : "Maya S."} · {t(`learn.${c.level.toLowerCase()}` as TKey)}
        </div>
        {pct > 0 ? (
          <div style={{ marginTop: 10 }}>
            <Bar pct={pct} />
            <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{pct}%</div>
          </div>
        ) : (
          <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>★ {c.rating} · {fmt(c.enrolled)} {t("learn.students")}</div>
        )}
      </div>
    </button>
  );
}

function Rail({ titleKey, ids, action }: { titleKey: TKey; ids: string[]; action?: string }) {
  const nav = useNavigate();
  const { t } = useStore();
  return (
    <section style={{ marginBottom: 34 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 19 }}>{t(titleKey)}</h2>
        {action && (
          <button onClick={() => nav("/learn")} style={{ background: "none", border: "none", color: "var(--gold)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {action} →
          </button>
        )}
      </div>
      <div className="no-scrollbar" style={{ display: "flex", gap: 14, overflowX: "auto", scrollSnapType: "x proximity", paddingBottom: 4 }}>
        {ids.map((id) => (
          <CourseCard key={id} id={id} />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const { t, courseProgress, completed } = useStore();
  const nav = useNavigate();
  const heroVidRef = useRef<HTMLVideoElement>(null);

  const featured = courses.filter((c) => c.featured).map((c) => c.id);
  const inProgress = courses.filter((c) => courseProgress(c.id) > 0 && courseProgress(c.id) < 100);

  // Day 22 memory/CPU rule: the decorative hero clip decodes only while it is
  // actually on screen and the tab is visible — and never for users with
  // prefers-reduced-motion, who get the still poster instead.
  useEffect(() => {
    const v = heroVidRef.current;
    if (!v) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
    let onScreen = true;
    const apply = () => {
      if (onScreen && !document.hidden) {
        v.play().catch(() => undefined);
      } else {
        v.pause();
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        apply();
      },
      { threshold: 0.15 }
    );
    io.observe(v);
    document.addEventListener("visibilitychange", apply);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", apply);
      v.pause();
    };
  }, []);

  return (
    <div className="anim-fade" style={{ paddingBottom: 110 }}>
      {/* hero */}
      <section style={{ position: "relative", minHeight: "72vh", display: "flex", alignItems: "flex-end", overflow: "hidden" }}>
        <video
          ref={heroVidRef}
          src={VID.landscapeB}
          poster={IMG.hero}
          muted
          loop
          playsInline
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(11,13,16,0.55) 0%, rgba(11,13,16,0.25) 40%, var(--bg) 96%)" }} />
        <div style={{ position: "relative", maxWidth: 1160, margin: "0 auto", width: "100%", padding: "0 20px 48px" }}>
          <div style={{ maxWidth: 620 }} className="anim-rise">
            <span className="eyebrow">Densen Academy — Learn · Create · Share · Connect</span>
            <h1 style={{ fontSize: "clamp(34px, 6vw, 58px)", fontWeight: 800, margin: "14px 0 12px", lineHeight: 1.05 }}>
              Dance is a language.
              <br />
              <span className="gold-grad-text">Speak it fluently.</span>
            </h1>
            <p className="muted" style={{ fontSize: 16, lineHeight: 1.6, margin: "0 0 24px" }}>
              Learn from world-class teachers, post your progress, duet with friends and climb the leaderboards — the social platform built for dancers.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => nav("/learn")}>
                <IcSparkles size={17} /> Start Learning
              </button>
              <button className="btn" onClick={() => nav("/feed")}>
                <IcPlay size={15} /> Watch the Feed
              </button>
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 20px 0" }}>
        {/* quick actions — the secondary destinations, one level inside Home */}
        <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 30 }}>
          {["feed", "create", "arcade", "challenges", "events", "leaderboards", "teams", "practice", "audio", "live", "progress"].map((r) => (
            <button key={r} className="chip" onClick={() => nav(`/${r}`)}>
              {t(`nav.${r}` as never)}
            </button>
          ))}
        </div>

        {/* challenge CTA */}
        <button
          onClick={() => nav("/challenge/ch1")}
          className="panel panel-hover anim-rise"
          style={{ display: "flex", width: "100%", textAlign: "left", gap: 16, padding: 18, cursor: "pointer", alignItems: "center", background: "linear-gradient(120deg, rgba(227,179,65,0.13), rgba(227,179,65,0.03) 55%), var(--panel)", borderColor: "var(--gold-line)", marginBottom: 34 }}
        >
          <img src={IMG.catBattle} alt="" style={{ width: 88, height: 88, borderRadius: 16, objectFit: "cover" }} />
          <div style={{ flex: 1 }}>
            <span className="eyebrow">🔥 {t("home.challengeCta")}</span>
            <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 6 }}>{t("home.challengeCtaSub")}</div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>4,218 {t("challenges.participants")} · 3 {t("challenges.daysLeft")}</div>
          </div>
          <span className="btn btn-primary btn-sm hide-mobile">{t("home.joinChallenge")}</span>
        </button>

        {/* continue learning */}
        {inProgress.length > 0 && (
          <section style={{ marginBottom: 34 }}>
            <h2 style={{ fontSize: 19, marginBottom: 14 }}>{t("home.continueLearning")}</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {inProgress.slice(0, 2).map((c) => {
                const pct = courseProgress(c.id);
                const next = c.lessons.find((l) => !completed.has(l.id));
                return (
                  <button
                    key={c.id}
                    onClick={() => nav(`/lesson/${c.id}/${(next ?? c.lessons[0]).id}`)}
                    className="panel panel-hover"
                    style={{ display: "flex", gap: 14, padding: 12, alignItems: "center", cursor: "pointer", textAlign: "left", color: "inherit" }}
                  >
                    <div style={{ position: "relative", width: 120, aspectRatio: "16/10", borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
                      <img src={c.cover} alt="" className="media-cover" />
                      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>
                        <IcPlay size={26} />
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 3 }}>{c.title}</div>
                      <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                        {t("home.resume")}: {next?.title ?? c.lessons[0].title}
                      </div>
                      <Bar pct={pct} />
                      <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                        {pct}% · {c.lessons.length - c.lessons.filter((l) => completed.has(l.id)).length} {t("home.lessonsLeft")}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <Rail titleKey="home.featured" ids={featured} action={t("home.viewAll")} />

        {/* categories */}
        <section style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 19, marginBottom: 14 }}>{t("home.categories")}</h2>
          <div className="cat-grid">
            {[
              { label: "Hip Hop", img: IMG.catHipHop, cat: "Hip Hop" },
              { label: "Commercial", img: IMG.catCommercial, cat: "Commercial" },
              { label: "Contemporary", img: IMG.catContemporary, cat: "Contemporary" },
              { label: "Jazz", img: IMG.catJazz, cat: "Jazz" },
              { label: "Latin", img: IMG.catLatin, cat: "Latin" },
              { label: "Kids", img: IMG.catKids, cat: "Kids" },
              { label: "Beginners", img: IMG.catBeginners, cat: "Beginners" },
              { label: "Advanced", img: IMG.catAdvanced, cat: "Advanced" },
            ].map((cat) => (
              <button
                key={cat.cat}
                onClick={() => nav(`/learn?cat=${encodeURIComponent(cat.cat)}`)}
                style={{
                  position: "relative",
                  aspectRatio: "1/1",
                  borderRadius: 18,
                  overflow: "hidden",
                  border: "1px solid var(--line)",
                  cursor: "pointer",
                  padding: 0,
                  background: "var(--panel)",
                }}
              >
                <img src={cat.img} alt={cat.label} className="media-cover" loading="lazy" style={{ transition: "transform 0.4s ease" }} />
                <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.72))" }} />
                <span style={{ position: "absolute", left: 12, bottom: 11, fontWeight: 800, fontFamily: "Sora", fontSize: 14, textAlign: "left" }}>{cat.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* footer */}
        <footer style={{ marginTop: 40, paddingTop: 22, borderTop: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between" }}>
          <span className="faint" style={{ fontSize: 12.5 }}>© 2026 Densen Academy</span>
          <span className="faint" style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IcFlame size={14} /> Learn · Create · Share · Connect
          </span>
        </footer>
      </div>
    </div>
  );
}
