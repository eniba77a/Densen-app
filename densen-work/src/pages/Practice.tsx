import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Bar, Empty, Page, StatCard } from "../components/ui";
import { Modal } from "../components/gov-ui";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import type { TKey } from "../i18n";

/**
 * DENSEN — MY PRACTICE (Day 12).
 * The user's practice workspace and the heart of the DENSEN loop:
 * LEARN → PRACTICE → RECORD → COMPARE → COMPLETE → SHARE.
 *
 * Every number here is live server state (practiceWire subscriptions):
 * saved Moves / Combos / Choreographies / Classes with step checklists,
 * aggregated practice time, completion status. RECORD MY ATTEMPT logs a
 * real session (≥ 60s, anti-farm) and carries the side-by-side compare
 * pair (teacher ref + attempt ref). No AI movement analysis is claimed —
 * the compare panel stores references only.
 */

type ServerStep = { label: string; done?: boolean };

type PracticeItem = {
  id: string;
  kind: "move" | "combo" | "choreography" | "class";
  title: string;
  subtitle?: string;
  style?: string;
  difficulty?: string;
  contentRef: string;
  href?: string;
  steps: ServerStep[];
  progress: { pct: number; doneCount: number; total: number };
  completedAt?: number;
  sessionCount: number;
  lastPracticedAt?: number;
  totalSeconds: number;
  bestAttemptRef?: string;
  createdAt: number;
};

type PracticeSummary = { total: number; active: number; completed: number; totalSeconds: number; avgProgressPct: number };

const KIND_ICON: Record<PracticeItem["kind"], string> = {
  move: "🦶",
  combo: "🧩",
  choreography: "✨",
  class: "🎓",
};

const fmtMin = (s: number) => {
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function Practice() {
  const { t, toast } = useStore();
  const auth = useAuth();
  const nav = useNavigate();
  const token = auth.sessionToken;

  const data = useQuery(
    api.practiceWire.getMyPractice,
    token ? { sessionToken: token } : "skip"
  );
  const toggleStepMu = useMutation(api.practiceWire.toggleItemStep);
  const recordMu = useMutation(api.practiceWire.recordSession);
  const completeMu = useMutation(api.practiceWire.completeItem);

  const [tab, setTab] = useState<"active" | "done">("active");
  const [sessionItem, setSessionItem] = useState<PracticeItem | null>(null);
  const [minutes, setMinutes] = useState(5);
  const [attemptRef, setAttemptRef] = useState("");
  const [teacherRef, setTeacherRef] = useState("");
  const [busy, setBusy] = useState(false);

  const items: PracticeItem[] = useMemo(() => data?.ok ? data.items : [], [data]);
  const summary: PracticeSummary = useMemo(
    () =>
      data?.ok
        ? data.summary
        : { total: 0, active: 0, completed: 0, totalSeconds: 0, avgProgressPct: 0 },
    [data]
  );
  const shown = useMemo(
    () => (tab === "done" ? items.filter((i) => i.completedAt) : items.filter((i) => !i.completedAt)),
    [items, tab]
  );

  if (!auth.viewer) {
    return (
      <Page>
        <Empty icon="🕺" text={t("practice.signin")} />
      </Page>
    );
  }

  const doToggle = async (item: PracticeItem, index: number) => {
    if (!token) return;
    try {
      await toggleStepMu({ sessionToken: token, itemId: item.id, index });
    } catch {
      /* reactive query keeps the last good state */
    }
  };

  const doRecord = async () => {
    if (!token || !sessionItem) return;
    setBusy(true);
    try {
      const res = (await recordMu({
        sessionToken: token,
        itemId: sessionItem.id,
        seconds: Math.max(0, Math.round(minutes * 60)),
        attemptVideoRef: attemptRef.trim() || undefined,
        teacherVideoRef: teacherRef.trim() || undefined,
      })) as { ok: boolean; error?: string; xpGranted?: number; streakMilestoneXp?: number };
      if (!res.ok) {
        toastFor(res.error);
      } else {
        const xp = (res.xpGranted ?? 0) + (res.streakMilestoneXp ?? 0);
        toast(xp > 0 ? `${t("practice.logged")} +${xp} XP` : t("practice.logged"));
        setSessionItem(null);
        setAttemptRef("");
        setTeacherRef("");
        setMinutes(5);
      }
    } finally {
      setBusy(false);
    }
  };

  const doComplete = async (item: PracticeItem) => {
    if (!token) return;
    setBusy(true);
    try {
      const res = (await completeMu({ sessionToken: token, itemId: item.id })) as {
        ok: boolean;
        error?: string;
        xpGranted?: number;
        creditsGranted?: number;
        newAchievements?: string[];
      };
      if (!res.ok) {
        toastFor(res.error);
      } else {
        const parts = [`+${res.xpGranted ?? 0} XP`];
        if ((res.creditsGranted ?? 0) > 0) parts.push(`+${res.creditsGranted} ✦`);
        if ((res.newAchievements ?? []).length > 0) parts.push("🏅");
        toast(`${t("practice.completed")} ${parts.join(" · ")}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const toastFor = (err: string | undefined) => {
    if (err === "too_short") toast(t("practice.tooShort"));
    else if (err === "steps_incomplete") toast(t("practice.stepsIncomplete"));
    else if (err === "already_completed") toast(t("practice.alreadyDone"));
    else if (err === "daily_cap") toast(t("practice.dailyCap"));
    else toast(t("common.error"));
  };

  return (
    <Page>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>{t("practice.title")}</h1>
        <span className="faint" style={{ fontSize: 12.5 }}>
          {t("practice.loop")}
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: 18, fontSize: 13.5 }}>
        {t("practice.tagline")}
      </p>

      {/* header stats — live aggregates */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 22 }}>
        <StatCard icon="🎯" value={summary.active} label={t("practice.statActive")} />
        <StatCard icon="🏁" value={summary.completed} label={t("practice.statCompleted")} />
        <StatCard icon="⏱️" value={fmtMin(summary.totalSeconds)} label={t("practice.statTime")} />
        <StatCard icon="📈" value={`${summary.avgProgressPct}%`} label={t("practice.statAvg")} />
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["active", "done"] as const).map((k) => (
          <button
            key={k}
            className={`btn btn-sm ${tab === k ? "btn-primary" : ""}`}
            onClick={() => setTab(k)}
          >
            {k === "active" ? `${t("practice.tabActive")} (${summary.active})` : `${t("practice.tabDone")} (${summary.completed})`}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="panel" style={{ padding: 22, textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🕺</div>
          <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{t("practice.emptyTitle")}</p>
          <p className="muted" style={{ margin: "0 0 14px", fontSize: 13 }}>
            {t("practice.emptyBody")}
          </p>
          <button className="btn btn-primary" onClick={() => nav("/learn")}>
            {t("practice.browseCta")}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <Empty icon="🧺" text={tab === "done" ? t("practice.noDone") : t("practice.noActive")} />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {shown.map((item) => (
            <PracticeCard
              key={item.id}
              item={item}
              token={token}
              onToggle={doToggle}
              onOpenSession={() => {
                setSessionItem(item);
                setMinutes(5);
                setAttemptRef("");
                setTeacherRef("");
              }}
              onComplete={() => void doComplete(item)}
              busy={busy}
            />
          ))}
        </div>
      )}

      {/* RECORD MY ATTEMPT — session logger + compare pair */}
      <Modal open={sessionItem !== null} onClose={() => setSessionItem(null)} title={t("practice.recordTitle")}>
        {sessionItem && (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>{KIND_ICON[sessionItem.kind]}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{sessionItem.title}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  {t("practice.sessionMin")} · {t("practice.currentProgress", { n: sessionItem.progress.pct })}
                </div>
              </div>
            </div>

            <label style={{ display: "grid", gap: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>{t("practice.minutes")}</span>
              <input
                type="number"
                min={1}
                max={240}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>{t("practice.attemptRef")}</span>
              <input
                type="text"
                value={attemptRef}
                onChange={(e) => setAttemptRef(e.target.value)}
                placeholder={t("practice.attemptRefPh")}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span className="faint" style={{ fontSize: 12 }}>{t("practice.teacherRef")}</span>
              <input
                type="text"
                value={teacherRef}
                onChange={(e) => setTeacherRef(e.target.value)}
                placeholder={t("practice.teacherRefPh")}
                style={inputStyle}
              />
            </label>

            <div className="panel" style={{ padding: 12, borderColor: "var(--gold-line)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t("practice.compareTitle")}</div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{t("practice.compareBody")}</p>
            </div>

            <button className="btn btn-primary" disabled={busy} onClick={() => void doRecord()}>
              {t("practice.recordCta")}
            </button>
          </div>
        )}
      </Modal>
    </Page>
  );
}

/* ---------------- one practice card ---------------- */

function PracticeCard({
  item,
  token,
  onToggle,
  onOpenSession,
  onComplete,
  busy,
}: {
  item: PracticeItem;
  token: string | null;
  onToggle: (item: PracticeItem, index: number) => void;
  onOpenSession: () => void;
  onComplete: () => void;
  busy: boolean;
}) {
  const { t } = useStore();
  const done = Boolean(item.completedAt);
  const pct = item.progress.pct;

  return (
    <div className="panel" style={{ padding: 16 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 20 }}>{KIND_ICON[item.kind]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.title}
            {done && <span style={{ color: "var(--gold)", marginLeft: 6 }}>🏁</span>}
          </div>
          <div className="faint" style={{ fontSize: 12 }}>
            {t(`practice.kind.${item.kind}` as TKey)}
            {item.style ? ` · ${item.style}` : ""}
            {item.sessionCount > 0 ? ` · ${t("practice.sessions", { n: item.sessionCount })}` : ""}
            {item.totalSeconds > 0 ? ` · ${fmtMin(item.totalSeconds)}` : ""}
          </div>
        </div>
        {/* the Commercial Combo #03 72% pattern */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: done ? "var(--gold)" : undefined }}>{pct}%</div>
        </div>
      </div>

      {/* steps */}
      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        {item.steps.map((s, i) => {
          const checked = s.done === true;
          const skipped = s.done === undefined;
          return (
            <button
              key={i}
              onClick={() => token && !done && onToggle(item, i)}
              disabled={done || s.done === undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "none",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: done || skipped ? "default" : "pointer",
                color: skipped ? "var(--ink-faint)" : checked ? "var(--ink)" : "var(--ink-faint)",
                fontSize: 13.5,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: `1.5px solid ${checked ? "var(--gold)" : "var(--line)"}`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  flexShrink: 0,
                  background: checked ? "var(--gold)" : "transparent",
                  color: "#171204",
                }}
              >
                {checked ? "✓" : skipped ? "–" : ""}
              </span>
              <span style={{ textDecoration: checked ? "none" : "none", opacity: checked ? 1 : 0.85 }}>{s.label}</span>
            </button>
          );
        })}
      </div>

      <Bar pct={pct} />

      {/* actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn btn-sm btn-primary" onClick={onOpenSession}>
          🎥 {t("practice.record")}
        </button>
        {item.href && (
          <button className="btn btn-sm" onClick={() => (window.location.href = item.href!)}>
            ▶ {t("practice.openContent")}
          </button>
        )}
        {!done && pct === 100 && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onComplete}>
            🏁 {t("practice.complete")}
          </button>
        )}
        {done && <span className="faint" style={{ fontSize: 12, alignSelf: "center" }}>{t("practice.doneNote")}</span>}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "10px 12px",
  color: "var(--ink)",
  fontSize: 14,
};
