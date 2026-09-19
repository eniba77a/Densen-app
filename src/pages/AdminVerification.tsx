/**
 * DENSEN — Admin teacher-verification console (Day 2).
 * =====================================================
 * Admin-only: the server enforces `requireRole(admin)` on every call; this
 * page renders a clear non-authorized state otherwise. Approve grants the
 * teacher role; reject returns the account to dancer — both with an audit
 * trail. PENDING → VERIFIED | REJECTED only.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { convexUp } from "./AuthFlow";
import { Logo } from "../components/ui";

export default function AdminVerification() {
  const { t, lang } = useStore();
  const { sessionToken, viewer } = useAuth();

  const queue = useQuery(
    api.admin.verificationQueue,
    sessionToken && convexUp() ? { adminSessionToken: args_token(sessionToken) } : "skip"
  );

  const decide = useMutation(api.admin.decideVerificationAction);
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");

  if (!convexUp()) {
    return <AdminShell ok>{t("auth.offline.body")}</AdminShell>;
  }
  if (!sessionToken) {
    return (
      <AdminShell ok>
        {t("adminv.login_required")}{" "}
        <Link to="/login?returnTo=%2Fadmin%2Fverification" style={{ color: "var(--gold)", fontWeight: 700 }}>
          {t("login.submit")}
        </Link>
      </AdminShell>
    );
  }
  if (viewer && viewer.role !== "admin") {
    return <AdminShell ok>{t("adminv.not_authorized")}</AdminShell>;
  }

  const act = async (teacherProfileId: string, decision: "approve" | "reject") => {
    if (!sessionToken) return;
    setBusyId(teacherProfileId);
    setErr("");
    try {
      const res = await decide({ adminSessionToken: sessionToken, teacherProfileId, decision });
      if (!("ok" in res && res.ok)) setErr(t("adminv.action_failed"));
    } catch {
      setErr(t("auth.err.network"));
    } finally {
      setBusyId("");
    }
  };

  const rows =
    queue && typeof queue === "object" && "ok" in queue && queue.ok
      ? (queue as { queue: { teacherProfileId: string; displayName: string; styles: string[]; submittedAt: number }[] }).queue
      : null;

  return (
    <AdminShell ok={viewer?.role === "admin" ? undefined : false}>
      {rows ? (
        rows.length === 0 ? (
          <div className="panel" style={{ padding: 18 }}>{t("adminv.empty")}</div>
        ) : (
          rows.map((r) => (
            <div key={r.teacherProfileId} className="panel" style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>{r.displayName}</strong>
                <span className="chip">{r.styles.length > 0 ? r.styles.join(", ") : "—"}</span>
              </div>
              <p className="faint" style={{ fontSize: 12, margin: "0 0 10px" }}>
                {new Date(r.submittedAt).toLocaleDateString(lang === "sq" ? "sq-AL" : "en-GB")}
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" disabled={busyId === r.teacherProfileId} onClick={() => act(r.teacherProfileId, "approve")}>
                  ✓ {t("adminv.approve")}
                </button>
                <button className="btn" style={{ background: "var(--line)", color: "var(--ink)" }} disabled={busyId === r.teacherProfileId} onClick={() => act(r.teacherProfileId, "reject")}>
                  ✕ {t("adminv.reject")}
                </button>
              </div>
            </div>
          ))
        )
      ) : (
        <p className="faint" style={{ fontSize: 13 }}>{t("account.loading")}</p>
      )}
      {err ? <p role="alert" style={{ color: "var(--err)", fontSize: 12.5, fontWeight: 700 }}>⚠ {err}</p> : null}
      <p className="faint" style={{ fontSize: 12 }}>
        <Link to="/" style={{ color: "var(--gold)", fontWeight: 700 }}>← {t("login.back_home")}</Link>
      </p>
    </AdminShell>
  );
}

function args_token(token: string): string {
  return token;
}

function AdminShell({ children, ok }: { children: React.ReactNode; ok?: boolean | undefined }) {
  const { t } = useStore();
  void ok;
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "22px 18px calc(40px + var(--sab))" }} className="anim-fade">
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <Logo size={26} />
      </div>
      <span className="eyebrow">{t("adminv.eyebrow")}</span>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 18px" }}>{t("adminv.title")}</h1>
      {children}
    </div>
  );
}
