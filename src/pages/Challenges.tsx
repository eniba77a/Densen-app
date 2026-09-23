import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, Bar, Empty, Page } from "../components/ui";
import { IcPlay, IcTrophy } from "../components/icons";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { fmt, userById } from "../data/store";

/* Live server challenge view (from challengesWire.listChallenges). */
type ServerChallenge = {
  id: string;
  title: string;
  description: string;
  rules?: string;
  style?: string;
  difficulty?: string;
  phase: "upcoming" | "active" | "ended";
  daysLeft: number;
  participantCount: number;
  submissionCount: number;
  progressPct: number;
  hasJoined: boolean;
  hasSubmitted: boolean;
  mySubmissionStatus?: string;
  hasCompleted: boolean;
  reward: { xp?: number; credits?: number; badgeCode?: string };
};

/** Merge server catalog (Day 11 lifecycle) with the seed cards (visuals). */
function useChallengeCatalog() {
  const auth = useAuth();
  const server = useQuery(
    api.challengesWire.listChallenges,
    auth.sessionToken ? { sessionToken: auth.sessionToken } : {}
  );
  return server?.ok ? (server.challenges as ServerChallenge[]) : undefined;
}

/* ---------------- list ---------------- */
export function ChallengesPage() {
  const { t } = useStore();
  const nav = useNavigate();
  const [tab, setTab] = useState<"active" | "upcoming" | "ended">("active");

  const list = useChallengeCatalog();

  const filtered = useMemo(() => {
    if (!list) return undefined;
    return list.filter((c) => c.phase === tab);
  }, [list, tab]);

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

      {!filtered ? (
        <p className="muted" style={{ textAlign: "center", padding: "40px 0" }}>…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {filtered.map((ch) => (
            <button
              key={ch.id}
              onClick={() => nav(`/challenge/${ch.id}`)}
              className="panel panel-hover"
              style={{ textAlign: "left", padding: 0, overflow: "hidden", cursor: "pointer", color: "inherit", position: "relative" }}
            >
              <div style={{ position: "relative", aspectRatio: "16/9", background: "linear-gradient(135deg, var(--gold-line), var(--panel-2))" }}>
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, opacity: 0.5 }}>
                  🏁
                </span>
                {ch.style && (
                  <span className="chip" style={{ position: "absolute", top: 10, left: 10, background: "rgba(10,12,16,0.75)", fontSize: 11 }}>
                    {ch.style}
                  </span>
                )}
                {ch.phase === "active" && ch.daysLeft > 0 && (
                  <span style={{ position: "absolute", bottom: 10, right: 10, background: "var(--gold)", color: "#131007", fontWeight: 800, fontSize: 11, padding: "4px 10px", borderRadius: 999 }}>
                    ⏳ {ch.daysLeft} {t("challenges.daysLeft")}
                  </span>
                )}
                {ch.hasCompleted && (
                  <span className="chip active" style={{ position: "absolute", top: 10, right: 10, fontSize: 11 }}>✓ {t("challenges.done")}</span>
                )}
              </div>
              <div style={{ padding: "13px 15px 15px" }}>
                <div style={{ fontWeight: 800, fontFamily: "Sora", fontSize: 15.5, marginBottom: 5 }}>{ch.title}</div>
                <div className="faint" style={{ fontSize: 12.5 }}>
                  🔥 {fmt(ch.participantCount)} {t("challenges.participants")} · 🎥 {ch.submissionCount}
                </div>
                {/* progress bar: submissions vs participants, server-computed */}
                <div style={{ marginTop: 10 }}>
                  <div className="faint" style={{ fontSize: 10.5, marginBottom: 4 }}>{t("challenges.progress")}: {ch.progressPct}%</div>
                  <Bar pct={ch.progressPct} />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {ch.reward.xp !== undefined && <span className="chip" style={{ fontSize: 10.5 }}>+{ch.reward.xp} XP</span>}
                  {ch.reward.credits !== undefined && <span className="chip" style={{ fontSize: 10.5 }}>+{ch.reward.credits} ✦</span>}
                  {ch.reward.badgeCode && <span className="chip" style={{ fontSize: 10.5, borderColor: "var(--gold-line)", color: "var(--gold)" }}>🏅</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {filtered?.length === 0 && <Empty icon="🏁" text={t("notifications.empty")} />}
    </Page>
  );
}

/* ---------------- detail ---------------- */
export function ChallengeDetail() {
  const { challengeId } = useParams();
  const nav = useNavigate();
  const { t, toast } = useStore();
  const auth = useAuth();
  const joinChallenge = useMutation(api.challengesWire.joinChallenge);
  const submitEntry = useMutation(api.challengesWire.submitChallengeEntry);
  const completeChallenge = useMutation(api.challengesWire.completeChallenge);

  const detail = useQuery(
    api.challengesWire.getChallenge,
    challengeId ? { challengeId, sessionToken: auth.sessionToken ?? undefined } : "skip"
  );

  const [postId, setPostId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (detail && !detail.ok) return <Page><Empty icon="🔍" text="Challenge not found" /></Page>;
  const ch = detail?.ok ? (detail.challenge as ServerChallenge) : undefined;
  const subs = detail?.ok ? (detail.submissions as { id: string; userId: string; postId: string }[] | undefined) : undefined;

  const doJoin = async () => {
    if (!auth.sessionToken || !challengeId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await joinChallenge({ sessionToken: auth.sessionToken, challengeId });
      if (res.ok) toast(t("challenges.joinedToast"));
      else setErr(res.error);
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async () => {
    if (!auth.sessionToken || !challengeId || !postId.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await submitEntry({ sessionToken: auth.sessionToken, challengeId, postId: postId.trim() });
      if (res.ok) {
        toast(t("challenges.submittedToast"));
        setPostId("");
      } else {
        setErr(res.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const doComplete = async () => {
    if (!auth.sessionToken || !challengeId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await completeChallenge({ sessionToken: auth.sessionToken, challengeId });
      if (res.ok) {
        toast(
          `+${res.xpGranted} XP${res.creditsGranted ? ` · +${res.creditsGranted} ✦` : ""}${
            res.badgeGranted ? ` · 🏅 ${res.badgeCode}` : ""
          }`
        );
      } else {
        setErr(res.error);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!ch) return <Page><p className="muted" style={{ textAlign: "center", padding: 40 }}>…</p></Page>;

  const errorText: Record<string, string> = {
    already_joined: t("challenges.err.alreadyJoined"),
    not_active: t("challenges.err.notActive"),
    not_joined: t("challenges.err.notJoined"),
    already_submitted: t("challenges.err.alreadySubmitted"),
    post_not_own: t("challenges.err.postNotOwn"),
    post_not_published: t("challenges.err.postNotPublished"),
    post_not_found: t("challenges.err.postNotFound"),
    no_cleared_submission: t("challenges.err.noClearedSubmission"),
    not_ended: t("challenges.err.notEnded"),
    already_completed: t("challenges.err.alreadyCompleted"),
  };

  return (
    <Page>
      <button onClick={() => nav("/challenges")} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {t("nav.challenges")}
      </button>

      {/* hero */}
      <div style={{ position: "relative", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 18, background: "linear-gradient(135deg, var(--gold-line), var(--panel-2))", aspectRatio: "21/9" }}>
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, opacity: 0.4 }}>🏁</span>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 18, background: "linear-gradient(180deg, transparent, rgba(11,13,16,0.85))" }}>
          <span className="eyebrow">{ch.style ?? "DENSEN"} · {ch.phase}</span>
          <h1 style={{ fontSize: "clamp(22px, 4.5vw, 32px)", fontWeight: 800, margin: "6px 0" }}>{ch.title}</h1>
          <div className="muted" style={{ fontSize: 13.5 }}>
            🔥 {fmt(ch.participantCount)} {t("challenges.participants")} · 🎥 {ch.submissionCount}
            {ch.phase === "active" && ch.daysLeft > 0 && <> · ⏳ {ch.daysLeft} {t("challenges.daysLeft")}</>}
          </div>
        </div>
      </div>

      <p className="muted" style={{ lineHeight: 1.65, fontSize: 14.5, margin: "0 0 16px" }}>{ch.description}</p>

      {ch.rules && (
        <div className="panel" style={{ padding: 14, marginBottom: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t("challenges.rules")}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{ch.rules}</div>
        </div>
      )}

      {err && errorText[err] && (
        <div className="panel" style={{ padding: "10px 14px", marginBottom: 16, borderColor: "var(--gold-line)", fontSize: 13 }}>
          ⚠️ {errorText[err]}
        </div>
      )}

      {/* flow actions: JOIN → PRACTICE → SUBMIT → COMPLETE → REWARD */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {!ch.hasJoined ? (
          <button className="btn btn-primary" style={{ flex: 1, minWidth: 180 }} disabled={busy} onClick={doJoin}>
            <IcTrophy size={18} /> {t("challenges.join")}
          </button>
        ) : (
          <>
            {ch.phase === "active" && !ch.hasSubmitted && (
              <button className="btn btn-primary" style={{ flex: 1, minWidth: 180 }} onClick={() => nav(`/create?challenge=${ch.id}`)}>
                🎥 {t("challenges.submitVideo")}
              </button>
            )}
            {ch.hasSubmitted && (
              <span className="chip active" style={{ alignSelf: "center", padding: "10px 16px" }}>
                ✓ {t("challenges.submitted")} · {t(`challenges.subState.${ch.mySubmissionStatus ?? "pending"}` as never)}
              </span>
            )}
            {ch.phase === "ended" && ch.mySubmissionStatus === "cleared" && !ch.hasCompleted && (
              <button className="btn btn-primary" style={{ flex: 1, minWidth: 180 }} disabled={busy} onClick={doComplete}>
                🏁 {t("challenges.claimReward")}
              </button>
            )}
            {ch.hasCompleted && (
              <span className="chip active" style={{ alignSelf: "center", padding: "10px 16px" }}>
                🏆 {t("challenges.completed")}
              </span>
            )}
          </>
        )}
      </div>

      {/* submission id input (own published post) — visible while active+joined+unsubmitted */}
      {auth.sessionToken && ch.hasJoined && ch.phase === "active" && !ch.hasSubmitted && (
        <div className="panel" style={{ padding: 14, marginBottom: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{t("challenges.linkPost")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              placeholder={t("challenges.postIdPlaceholder")}
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
            />
            <button className="btn btn-primary" disabled={busy || !postId.trim()} onClick={doSubmit}>
              {t("challenges.submitEntry")}
            </button>
          </div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 7 }}>
            {t("challenges.linkPostHint")}
          </div>
        </div>
      )}

      {/* rewards */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>🏆 {t("challenges.prize")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {ch.reward.xp !== undefined && <span className="chip">+{ch.reward.xp} XP</span>}
          {ch.reward.credits !== undefined && <span className="chip">+{ch.reward.credits} ✦ {t("challenges.credits")}</span>}
          {ch.reward.badgeCode && <span className="chip" style={{ borderColor: "var(--gold-line)", color: "var(--gold)" }}>🏅 {t("challenges.badge")}</span>}
        </div>
      </section>

      {/* entries (cleared submissions) */}
      <section>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>🎥 {t("challenges.entries")}</h2>
        {!subs || subs.length === 0 ? (
          <Empty icon="🎬" text={t("challenges.submitVideo")} />
        ) : (
          <div className="panel" style={{ padding: "6px 14px" }}>
            {subs.map((s) => {
              const u = userById(s.userId);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                  <Avatar src={u?.avatar} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u?.name ?? t("challenges.anonymousDancer")}</div>
                    <div className="faint" style={{ fontSize: 11.5 }}>@{u?.username ?? s.userId.slice(0, 8)}</div>
                  </div>
                  <IcPlay size={16} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </Page>
  );
}


