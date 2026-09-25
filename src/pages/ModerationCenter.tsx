/**
 * DENSEN — Safety & Moderation (Day 15).
 * ======================================
 * The user-facing safety surface:
 *  - MY REPORTS — every report the dancer submitted, with live status and the
 *    moderator note when staff decided.
 *  - MY APPEALS — appeals against decisions on the dancer's own content,
 *    with the submit flow and staff review outcomes.
 *  - BLOCKED / MUTED — the caller's real block + mute lists (server rows when
 *    signed in), each with one-tap unblock/unmute.
 *
 * Guests see the prototype-local equivalents so the demo stays complete.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Page } from "../components/ui";
import { StatusPill, tx } from "../components/gov-ui";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { useGov } from "../state/governance";
import {
  MOD_APPEAL_STATUS_LABELS,
  MOD_CATEGORY_LABELS,
  MOD_STATUS_LABELS,
  MOD_TARGET_LABELS,
} from "../data/moderation";
import { useStoreLang } from "../components/gov-ui";

function statusPillStatus(status: string): "pass" | "warning" | "action_required" | "neutral" {
  switch (status) {
    case "resolved":
    case "dismissed":
      return "pass";
    case "action_taken":
    case "appealed":
      return "warning";
    case "under_review":
    case "pending":
      return "neutral";
    default:
      return "neutral";
  }
}

/* ---------------- my reports ---------------- */
interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  category: string;
  status: string;
  priority: string;
  reviewNote?: string;
  createdAt: number;
  resolvedAt?: number;
}

function MyReports({ rows, onAppeal }: { rows: ReportRow[] | undefined; onAppeal: (r: ReportRow) => void }) {
  const { t, lang } = useStore();
  const { viewer } = useAuth();
  return (
    <div className="panel" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 15, marginBottom: 10 }}>🚩 {t("mod.myReports")}</h2>
      {!rows ? (
        <p className="faint" style={{ fontSize: 13 }}>…</p>
      ) : rows.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, margin: 0, lineHeight: 1.7 }}>{t("mod.myReportsEmpty")}</p>
      ) : (
        rows.map((r) => (
          <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill status={statusPillStatus(r.status)} label={lang === "sq" ? MOD_STATUS_LABELS[r.status]?.sq ?? r.status : MOD_STATUS_LABELS[r.status]?.en ?? r.status} />
              <strong style={{ fontSize: 13 }}>
                {tx(MOD_TARGET_LABELS[r.targetType] ?? { en: r.targetType, sq: r.targetType }, lang)}
              </strong>
              <span style={{ fontSize: 12.5, flex: 1, minWidth: 160 }}>
                {tx(MOD_CATEGORY_LABELS[r.category] ?? { en: r.category, sq: r.category }, lang)}
              </span>
              <span className="faint" style={{ fontSize: 11.5 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
            {r.reviewNote && (
              <div className="faint" style={{ fontSize: 12, marginTop: 5, lineHeight: 1.6 }}>
                {t("mod.noteFromStaff")}: {r.reviewNote}
              </div>
            )}
            {viewer && (r.status === "action_taken" || r.status === "dismissed") && (
              <div style={{ marginTop: 6 }}>
                <button className="btn btn-sm" onClick={() => onAppeal(r)}>
                  ⚖️ {t("mod.appeal")}
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------- my appeals ---------------- */
interface AppealRow {
  id: string;
  targetType: string;
  targetId: string;
  statement: string;
  status: string;
  reviewNote?: string;
  createdAt: number;
}

function AppealForm({ reportId, targetId: fixedTargetId, targetType: fixedTargetType, onDone }: { reportId?: string; targetId?: string; targetType?: string; onDone: () => void }) {
  const { t, toast } = useStore();
  const lang = useStoreLang();
  const { sessionToken } = useAuth();
  const submit = useMutation(api.moderationWire.submitAppeal);
  const [targetType, setTargetType] = useState(fixedTargetType ?? "post");
  const [targetId, setTargetId] = useState(fixedTargetId ?? "");
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    if (!sessionToken) return;
    if (statement.trim().length < 10) {
      setErr(t("mod.appealShort"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = (await submit({
        sessionToken,
        reportId: reportId || undefined,
        targetType: targetType as "post" | "comment" | "user" | "message" | "challenge",
        targetId,
        statement: statement.trim(),
      })) as { ok: boolean; error?: string };
      if (!res.ok) {
        setErr(res.error === "appeal_exists" ? t("mod.appealExists") : res.error === "not_a_decision" ? t("mod.status.pending") : t("common.error"));
        setBusy(false);
        return;
      }
      toast(t("mod.appealSent"));
      setBusy(false);
      setStatement("");
      onDone();
    } catch {
      setErr(t("common.error"));
      setBusy(false);
    }
  };

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>⚖️ {t("mod.appealTitle")}</div>
      <label className="input-label" htmlFor="ap-type">{t("mod.admin.target")}</label>
      <select id="ap-type" className="input" style={{ marginBottom: 8 }} value={targetType} onChange={(e) => setTargetType(e.target.value)} disabled={Boolean(fixedTargetType)}>
        {Object.entries(MOD_TARGET_LABELS).map(([id, l]) => (
          <option key={id} value={id}>{tx(l, lang)}</option>
        ))}
      </select>
      <label className="input-label" htmlFor="ap-id">ID</label>
      <input id="ap-id" className="input" style={{ marginBottom: 8 }} value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="p…" disabled={Boolean(fixedTargetId)} />
      <label className="input-label" htmlFor="ap-st">{t("mod.appealStatement")}</label>
      <textarea id="ap-st" className="input" rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
      {err && <p role="alert" style={{ color: "var(--gold)", fontWeight: 700, fontSize: 12.5, marginTop: 6 }}>{err}</p>}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={busy || !targetId.trim()} onClick={() => void go()}>
        {busy ? "…" : t("mod.appealSubmit")}
      </button>
    </div>
  );
}

function MyAppeals({ rows }: { rows: AppealRow[] | undefined }) {
  const { t, lang } = useStore();
  const [formOpen, setFormOpen] = useState(false);
  const [appealTarget, setAppealTarget] = useState<{ reportId?: string; targetType: string; targetId: string } | null>(null);
  const { viewer } = useAuth();
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>⚖️ {t("mod.myAppeals")}</h2>
        {viewer && (
          <button className="btn btn-sm" onClick={() => { setAppealTarget(null); setFormOpen((o) => !o); }}>
            {formOpen && !appealTarget ? "—" : t("mod.appealCta")}
          </button>
        )}
      </div>
      {formOpen && !appealTarget && <AppealForm onDone={() => setFormOpen(false)} />}
      {appealTarget && (
        <AppealForm
          reportId={appealTarget.reportId}
          targetType={appealTarget.targetType}
          targetId={appealTarget.targetId}
          onDone={() => setAppealTarget(null)}
        />
      )}
      {!rows ? (
        <p className="faint" style={{ fontSize: 13, marginTop: 10 }}>…</p>
      ) : rows.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, margin: "10px 0 0", lineHeight: 1.7 }}>{t("mod.myAppealsEmpty")}</p>
      ) : (
        rows.map((a) => (
          <div key={a.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill
                status={a.status === "overturned" ? "pass" : a.status === "upheld" ? "action_required" : statusPillStatus(a.status)}
                label={lang === "sq" ? MOD_APPEAL_STATUS_LABELS[a.status]?.sq ?? a.status : MOD_APPEAL_STATUS_LABELS[a.status]?.en ?? a.status}
              />
              <strong style={{ fontSize: 13 }}>{tx(MOD_TARGET_LABELS[a.targetType] ?? { en: a.targetType, sq: a.targetType }, lang)}</strong>
              <span className="faint" style={{ fontSize: 11.5 }}>{new Date(a.createdAt).toLocaleDateString()}</span>
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.6 }}>{a.statement}</div>
            {a.reviewNote && (
              <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                {t("mod.noteFromStaff")}: {a.reviewNote}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------- blocked / muted ---------------- */
interface SafetyPerson {
  userId: string;
  handle: string;
  displayName: string;
}

function BlockMuteLists({ blocked, muted }: { blocked: SafetyPerson[] | undefined; muted: SafetyPerson[] | undefined }) {
  const { t } = useStore();
  const { sessionToken } = useAuth();
  const unblock = useMutation(api.moderationWire.unblockUser);
  const unmute = useMutation(api.moderationWire.unmuteUser);

  const doUnblock = (userId: string) => {
    if (sessionToken) void unblock({ sessionToken, targetUserId: userId }).catch(() => undefined);
  };
  const doUnmute = (userId: string) => {
    if (sessionToken) void unmute({ sessionToken, targetUserId: userId }).catch(() => undefined);
  };

  return (
    <>
      <div className="panel" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>🚫 {t("mod.blocked")}</h2>
        {!blocked ? (
          <p className="faint" style={{ fontSize: 13 }}>…</p>
        ) : blocked.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, margin: 0, lineHeight: 1.7 }}>{t("mod.blockedEmpty")}</p>
        ) : (
          blocked.map((b) => (
            <div key={b.userId} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{b.displayName}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>@{b.handle}</div>
              </div>
              <button className="btn btn-sm" onClick={() => doUnblock(b.userId)}>{t("gov.unblock")}</button>
            </div>
          ))
        )}
      </div>
      <div className="panel" style={{ padding: 16, marginTop: 12 }}>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>🔇 {t("mod.muted")}</h2>
        {!muted ? (
          <p className="faint" style={{ fontSize: 13 }}>…</p>
        ) : muted.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, margin: 0, lineHeight: 1.7 }}>{t("mod.mutedEmpty")}</p>
        ) : (
          muted.map((m) => (
            <div key={m.userId} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{m.displayName}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>@{m.handle}</div>
              </div>
              <button className="btn btn-sm" onClick={() => doUnmute(m.userId)}>{t("mod.unmute")}</button>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ---------------- page ---------------- */
export default function ModerationCenter() {
  const { t } = useStore();
  const { sessionToken } = useAuth();
  const gov = useGov();
  // Day 15 — "Contest this decision" pre-fills the appeal form from a decided
  // report row (single source: the reports row itself feeds the appeal).
  const [appealPrefill, setAppealPrefill] = useState<{ reportId?: string; targetType: string; targetId: string } | null>(null);

  // Live rows when signed in; prototype rows keep guests covered.
  const reportsQ = useQuery(api.moderationWire.myReports, sessionToken ? { sessionToken } : "skip");
  const appealsQ = useQuery(api.moderationWire.myAppeals, sessionToken ? { sessionToken } : "skip");
  const listsQ = useQuery(api.moderationWire.mySafetyLists, sessionToken ? { sessionToken } : "skip");

  const reports: ReportRow[] | undefined = sessionToken
    ? reportsQ && reportsQ.ok
      ? (reportsQ.reports as ReportRow[])
      : undefined
    : gov.reports.map((r, i) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        category: r.category,
        status: "pending",
        priority: "normal",
        createdAt: Date.parse(r.ts) || Date.now() - i * 1000,
      }));
  const appeals: AppealRow[] | undefined = sessionToken
    ? appealsQ && appealsQ.ok
      ? (appealsQ.appeals as AppealRow[])
      : undefined
    : [];
  const blocked: SafetyPerson[] | undefined = sessionToken
    ? listsQ && listsQ.ok
      ? (listsQ.blocked as SafetyPerson[])
      : undefined
    : gov.blocked.map((id) => ({ userId: id, handle: id, displayName: id }));
  const muted: SafetyPerson[] | undefined = sessionToken
    ? listsQ && listsQ.ok
      ? (listsQ.muted as SafetyPerson[])
      : undefined
    : gov.muted.map((id) => ({ userId: id, handle: id, displayName: id }));

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>🛡 {t("mod.title")}</h1>
      <p className="muted" style={{ margin: "0 0 20px", fontSize: 14 }}>{t("mod.subtitle")}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <MyReports rows={reports} onAppeal={(r) => setAppealPrefill({ reportId: r.id, targetType: r.targetType, targetId: r.targetId })} />
        {appealPrefill ? (
          <div className="panel" style={{ padding: 16 }}>
            <AppealForm
              reportId={appealPrefill.reportId}
              targetType={appealPrefill.targetType}
              targetId={appealPrefill.targetId}
              onDone={() => setAppealPrefill(null)}
            />
          </div>
        ) : (
          <MyAppeals rows={appeals} />
        )}
        {/* Day 15 — lists render for BOTH worlds: server rows when signed in,
            the prototype-local lists (gov state) for guests. */}
        <BlockMuteLists blocked={blocked} muted={muted} />
      </div>
    </Page>
  );
}
