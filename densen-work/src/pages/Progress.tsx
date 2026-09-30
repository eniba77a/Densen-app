import { useNavigate } from "react-router-dom";
import { Bar, Page, Ring, StatCard } from "../components/ui";
import { IcFlame } from "../components/icons";
import { useStore } from "../state/store";
import { courseById, courses } from "../data/store";
import type { TKey } from "../i18n";

export default function ProgressPage() {
  const { t, xp, level, xpIntoLevel, xpForLevel, streak, completed, courseProgress, recent, achievements } = useStore();
  const nav = useNavigate();

  const classesDone = completed.size;
  const activeCourses = courses.filter((c) => courseProgress(c.id) > 0 && courseProgress(c.id) < 100);
  const totalLessons = courses.reduce((n, c) => n + c.lessons.length, 0);
  const overall = Math.round((classesDone / totalLessons) * 100);

  const weekMin = Math.min(160, classesDone * 22);
  const weekGoal = 160;

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("progress.title")}</h1>
        <span className="chip" style={{ borderColor: "var(--gold-line)", color: "var(--gold)" }}>
          <IcFlame size={14} /> {streak} {t("progress.days")}
        </span>
      </div>
      <p className="muted" style={{ margin: "0 0 22px", fontSize: 14 }}>{t("progress.subtitle")}</p>

      {/* level card */}
      <div className="panel" style={{ padding: 18, marginBottom: 16, background: "linear-gradient(120deg, rgba(227,179,65,0.12), rgba(227,179,65,0.02) 60%), var(--panel)", borderColor: "var(--gold-line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Ring pct={(xpIntoLevel / xpForLevel) * 100} size={86} label={`${level}`} sub={t("progress.level")} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontFamily: "Sora", fontSize: 16, marginBottom: 2 }}>{fmt(xp)} {t("progress.xp")}</div>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              {t("progress.xpToNext", { level: level + 1 })}: {xpForLevel - xpIntoLevel}
            </div>
            <Bar pct={(xpIntoLevel / xpForLevel) * 100} />
          </div>
        </div>
      </div>

      {/* stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard icon="🎬" value={classesDone} label={t("progress.classesCompleted")} accent />
        <StatCard icon="📚" value={activeCourses.length} label={t("progress.currentCourses")} />
        <StatCard icon="🔥" value={streak} label={`${t("progress.streak")} (${t("progress.days")})`} />
        <StatCard icon="🏆" value={12} label={t("progress.achievements")} />
      </div>

      {/* overall completion + goals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 24 }}>
        <div className="panel" style={{ padding: 18, display: "flex", gap: 16, alignItems: "center" }}>
          <Ring pct={overall} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{t("progress.completion")}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {classesDone} {t("progress.of")} {totalLessons} {t("learn.lessons")}
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{t("progress.weeklyGoal")}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
            <span className="muted">{weekMin} / {weekGoal} {t("progress.minutes")}</span>
            <span className="gold-text" style={{ fontWeight: 800 }}>{Math.round((weekMin / weekGoal) * 100)}%</span>
          </div>
          <Bar pct={(weekMin / weekGoal) * 100} lg />
          <div style={{ fontWeight: 800, fontSize: 15, margin: "16px 0 12px" }}>{t("progress.monthlyGoal")}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
            <span className="muted">8 / 10 {t("learn.lessons")}</span>
            <span className="gold-text" style={{ fontWeight: 800 }}>80%</span>
          </div>
          <Bar pct={80} lg />
        </div>
      </div>

      {/* recently watched */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>{t("progress.recentlyWatched")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {recent.map((r) => {
            const c = courseById(r.courseId);
            const l = c?.lessons.find((x) => x.id === r.lessonId);
            if (!c || !l) return null;
            return (
              <button
                key={r.lessonId}
                onClick={() => nav(`/lesson/${c.id}/${l.id}`)}
                className="panel panel-hover"
                style={{ display: "flex", gap: 13, padding: 12, alignItems: "center", cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
              >
                <div style={{ position: "relative", width: 110, aspectRatio: "16/10", borderRadius: 11, overflow: "hidden", flexShrink: 0 }}>
                  <img src={c.cover} alt="" className="media-cover" />
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>▶</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{l.title}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{c.title}</div>
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>{r.at} · {l.dur} {t("common.min")}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* achievements */}
      <section>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>{t("progress.achievements")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {achievements.map((a) => (
            <div key={a.id} className="panel" style={{ padding: 14, textAlign: "center", opacity: a.unlocked ? 1 : 0.55, borderColor: a.unlocked ? "var(--gold-line)" : "var(--line)" }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{a.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{a.name}</div>
              <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>{a.desc}</div>
              {!a.unlocked && a.progress !== undefined && (
                <div style={{ marginTop: 8 }}>
                  <Bar pct={a.progress} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");
export type { TKey };
