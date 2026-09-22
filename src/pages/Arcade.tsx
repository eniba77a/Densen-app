import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Bar, Empty, Page, Ring, StatCard } from "../components/ui";
import { IcFlame } from "../components/icons";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import type { TKey } from "../i18n";

/**
 * DENSEN ARCADE (Day 9).
 * The dance gamification hub: level ladder, XP balance with progress to the
 * next level, current/best streak, completion counters (classes, combos,
 * choreographies, challenges), achievements and the XP ledger history.
 * All numbers come from the live `arcadeWire.getArcadeStats` subscription —
 * the ledger is the single source of truth; nothing here is decorative.
 */
export default function Arcade() {
  const { t } = useStore();
  const auth = useAuth();
  const stats = useQuery(
    api.arcadeWire.getArcadeStats,
    auth.sessionToken ? { sessionToken: auth.sessionToken } : "skip"
  );
  const config = useQuery(api.arcadeWire.getArcadeConfig, {});

  // Achievements are derived from the ledger (server truth), not local state.
  const achievements = useMemo(() => {
    if (!stats?.ok) return [];
    const c = stats.counts;
    return [
      { id: "ach_lesson1", icon: "🎓", need: 1, have: c.lessons, key: "arcade.ach.firstLesson" },
      { id: "ach_lesson10", icon: "🏅", need: 10, have: c.lessons, key: "arcade.ach.tenLessons" },
      { id: "ach_combo1", icon: "🧩", need: 1, have: c.combos, key: "arcade.ach.firstCombo" },
      { id: "ach_choreo1", icon: "💫", need: 1, have: c.choreographies, key: "arcade.ach.firstChoreo" },
      { id: "ach_challenge1", icon: "🏆", need: 1, have: c.challenges, key: "arcade.ach.firstChallenge" },
      { id: "ach_posts5", icon: "🎬", need: 5, have: c.posts, key: "arcade.ach.fivePosts" },
      { id: "ach_streak3", icon: "🔥", need: 3, have: stats.streakBest, key: "arcade.ach.streak3" },
      { id: "ach_streak7", icon: "⚡", need: 7, have: stats.streakBest, key: "arcade.ach.streak7" },
      { id: "ach_level5", icon: "👑", need: 5, have: stats.level, key: "arcade.ach.level5" },
      { id: "ach_level10", icon: "💎", need: 10, have: stats.level, key: "arcade.ach.level10" },
    ].map((a) => ({
      ...a,
      unlocked: a.have >= a.need,
      pct: Math.min(100, Math.round((a.have / a.need) * 100)),
    }));
  }, [stats]);

  if (!auth.sessionToken || (stats && !stats.ok)) {
    return (
      <Page>
        <Empty icon="🕹️" text={t("arcade.signin")} />
      </Page>
    );
  }
  if (!stats || !stats.ok) {
    return (
      <Page>
        <Empty icon="⏳" text={t("arcade.loading")} />
      </Page>
    );
  }

  const pctToNext = stats.atCap ? 100 : Math.round((stats.xpIntoLevel / Math.max(1, stats.xpForLevel ?? 1)) * 100);
  const ladder: { level: number; name: string; xpRequired: number }[] = config?.ok ? config.ladder : [];

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("arcade.title")}</h1>
        <span className="chip" style={{ borderColor: "var(--gold-line)", color: "var(--gold)" }}>
          <IcFlame size={14} /> {stats.streakCurrent} {t("arcade.days")}
        </span>
      </div>
      <p className="muted" style={{ margin: "0 0 22px", fontSize: 14 }}>{t("arcade.subtitle")}</p>

      {/* level + xp card */}
      <div
        className="panel"
        style={{
          padding: 18,
          marginBottom: 16,
          background: "linear-gradient(120deg, rgba(227,179,65,0.14), rgba(227,179,65,0.02) 60%), var(--panel)",
          borderColor: "var(--gold-line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Ring pct={pctToNext} size={86} label={`${stats.level}`} sub={t("arcade.level")} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontFamily: "Sora", fontSize: 17, marginBottom: 2 }}>
              {stats.levelName}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
              {stats.xp} {t("arcade.xp")}
            </div>
            {stats.atCap ? (
              <div className="muted" style={{ fontSize: 12.5 }}>{t("arcade.maxLevel")}</div>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
                  {t("arcade.xpToNext", { level: stats.level + 1 })}: {(stats.xpForLevel ?? 0) - stats.xpIntoLevel}
                </div>
                <Bar pct={pctToNext} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* streaks */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard icon="🔥" value={stats.streakCurrent} label={t("arcade.currentStreak")} accent />
        <StatCard icon="🏅" value={stats.streakBest} label={t("arcade.bestStreak")} />
        <StatCard icon="⚡" value={`${stats.counts.lessons + stats.counts.combos + stats.counts.choreographies}`} label={t("arcade.completed")} />
        <StatCard icon="🏆" value={achievements.filter((a) => a.unlocked).length} label={t("arcade.achievements")} />
      </div>

      {/* completion counters */}
      <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{t("arcade.completions")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
          <StatCard icon="🎓" value={stats.counts.lessons} label={t("arcade.classes")} />
          <StatCard icon="🧩" value={stats.counts.combos} label={t("arcade.combos")} />
          <StatCard icon="💫" value={stats.counts.choreographies} label={t("arcade.choreographies")} />
          <StatCard icon="🏁" value={stats.counts.challenges} label={t("arcade.challenges")} />
          <StatCard icon="🎬" value={stats.counts.posts} label={t("arcade.posts")} />
        </div>
      </div>

      {/* level ladder */}
      {ladder.length > 0 && (
        <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{t("arcade.ladder")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ladder.map((l) => {
              const reached = stats.level >= l.level;
              const isCurrent = stats.level === l.level;
              return (
                <div
                  key={l.level}
                  className="chip"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    opacity: reached ? 1 : 0.55,
                    borderColor: isCurrent ? "var(--gold)" : "var(--line)",
                    background: isCurrent ? "rgba(227,179,65,0.08)" : undefined,
                  }}
                >
                  <span style={{ fontWeight: isCurrent ? 800 : 500 }}>
                    {l.level}. {t(`arcade.lv${l.level}` as TKey)}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>{l.xpRequired} XP</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* how to earn */}
      {config?.ok && (
        <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>{t("arcade.earnTitle")}</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{t("arcade.earnNote")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            {(
              [
                ["lesson_complete", "arcade.earn.lesson"],
                ["combo_complete", "arcade.earn.combo"],
                ["choreography_complete", "arcade.earn.choreo"],
                ["challenge_complete", "arcade.earn.challenge"],
                ["practice_session", "arcade.earn.practice"],
                ["content_publish", "arcade.earn.publish"],
              ] as const
            ).map(([kind, key]) => (
              <div key={kind} className="chip" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{t(key)}</span>
                <span style={{ color: "var(--gold)", fontWeight: 700 }}>+{config.xpValues[kind]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* achievements */}
      <div className="panel" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{t("arcade.achievements")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {achievements.map((a) => (
            <div
              key={a.id}
              className="chip"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                alignItems: "flex-start",
                opacity: a.unlocked ? 1 : 0.6,
                borderColor: a.unlocked ? "var(--gold-line)" : "var(--line)",
              }}
            >
              <span style={{ fontSize: 20 }}>{a.icon}</span>
              <span style={{ fontWeight: 700, fontSize: 12.5 }}>{t(a.key as TKey)}</span>
              <span className="muted" style={{ fontSize: 11 }}>
                {a.unlocked ? t("arcade.unlocked") : `${a.have}/${a.need}`}
              </span>
              {!a.unlocked && <Bar pct={a.pct} />}
            </div>
          ))}
        </div>
      </div>

      {/* xp ledger history */}
      <div className="panel" style={{ padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>{t("arcade.history")}</div>
        {stats.recent.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>{t("arcade.noHistory")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {stats.recent.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{t(`arcade.r.${r.reason}` as TKey) ?? r.reason}</span>
                <span style={{ color: r.amount > 0 ? "var(--gold)" : "var(--danger)", fontWeight: 700 }}>
                  {r.amount > 0 ? `+${r.amount}` : r.amount}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
