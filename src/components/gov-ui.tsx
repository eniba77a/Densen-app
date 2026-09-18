import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useGov } from "../state/governance";
import { DOCS, type DocId, type Bi, COOKIE_CATEGORIES, REPORT_CATEGORIES, PERMISSIONS, type PermissionKey, type AuditStatus } from "../data/governance";
import { useStore } from "../state/store";
import type { Lang } from "../i18n";
import { IcCheck, IcShield, IcVerified } from "./icons";

/* ---------------- bilingual text helper ---------------- */
export function useLang(): Lang {
  return useStore().lang;
}
export function tx(b: Bi, lang: Lang): string {
  return b[lang];
}

/* ---------------- status pill (icon + text, never color-only) ---------------- */
export function StatusPill({ status, label }: { status: AuditStatus | "neutral"; label?: string }) {
  const { t } = useStore();
  const map: Record<string, { icon: string; key: "gov.pass" | "gov.warning" | "gov.action" | undefined }> = {
    pass: { icon: "✓", key: "gov.pass" },
    warning: { icon: "!", key: "gov.warning" },
    action_required: { icon: "✕", key: "gov.action" },
    neutral: { icon: "•", key: undefined },
  };
  const m = map[status] ?? map.neutral;
  return (
    <span className={`status ${status}`} role="status">
      <span aria-hidden="true">{m.icon}</span>
      {label ?? (m.key ? t(m.key) : status)}
    </span>
  );
}

/* ---------------- Modal with focus trap + Escape ---------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastActive = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement;
    const node = ref.current;
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    const first = focusables()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (idx <= 0)) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && idx === list.length - 1) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
      (lastActive.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>{title}</h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close" style={{ width: 36, height: 36 }}>
            ✕
          </button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- settings-style link row ---------------- */
export function LinkRow({ to, icon, label, sub, badge }: { to: string; icon: string; label: string; sub?: string; badge?: ReactNode }) {
  return (
    <Link to={to} className="row-link" style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 2px", borderBottom: "1px solid var(--line)", textDecoration: "none", color: "inherit" }}>
      <span aria-hidden="true" style={{ fontSize: 19, width: 26, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>{label}</span>
        {sub && <span className="faint" style={{ display: "block", fontSize: 12, marginTop: 2 }}>{sub}</span>}
      </span>
      {badge}
      <span aria-hidden="true" className="faint">›</span>
    </Link>
  );
}

/* ---------------- legal document renderer ---------------- */
export function LegalDoc({ id }: { id: DocId }) {
  const { t, lang } = useStore();
  const doc = DOCS[id];
  return (
    <article className="doc">
      <span className="eyebrow">{t("gov.legal")}</span>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 10px" }}>{doc.title[lang]}</h1>
      <div className="panel" style={{ padding: "12px 14px", marginBottom: 14, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
        <span><span className="faint">{t("gov.version")}: </span><strong>{doc.version}</strong></span>
        <span><span className="faint">{t("gov.effective")}: </span><strong>{doc.effective}</strong></span>
        <span><span className="faint">{t("gov.updated")}: </span><strong>{doc.updated}</strong></span>
      </div>
      <div className="legal-note" role="note">
        <strong><IcShield size={14} style={{ verticalAlign: "-2px" }} /> </strong>
        {DOCS[id].intro[lang]}
      </div>
      {doc.sections.map((s, i) => (
        <section key={i}>
          <h2>{s.h[lang]}</h2>
          {s.p.map((p, j) => (
            <p key={j}>{p[lang]}</p>
          ))}
        </section>
      ))}
    </article>
  );
}

/* ---------------- cookie consent banner ---------------- */
export function CookieBanner() {
  const { t } = useStore();
  const { cookieConsent, setCookieConsent } = useGov();
  const [managing, setManaging] = useState(false);
  const [functional, setFunctional] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  if (cookieConsent) return null;

  const save = (c: { functional: boolean; analytics: boolean; marketing: boolean }) => {
    setCookieConsent(c, managing ? "cookie_banner.manage" : "cookie_banner");
  };

  return (
    <div className="cookie-banner" role="dialog" aria-modal="false" aria-label={t("gov.cookie.title")}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{t("gov.cookie.title")}</h2>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>{t("gov.cookie.body")}</p>

      {managing && (
        <div style={{ marginBottom: 14 }}>
          {COOKIE_CATEGORIES.map((c) => {
            const checked = c.optional ? (c.id === "functional" ? functional : c.id === "analytics" ? analytics : marketing) : true;
            const set = (v: boolean) => (c.id === "functional" ? setFunctional(v) : c.id === "analytics" ? setAnalytics(v) : setMarketing(v));
            return (
              <div key={c.id} className="checkbox-row">
                <input
                  id={`ck-${c.id}`}
                  type="checkbox"
                  checked={checked}
                  disabled={!c.optional}
                  onChange={(e) => set(e.target.checked)}
                />
                <label htmlFor={`ck-${c.id}`}>
                  <strong>{tx(c.name, useStoreLang())}</strong>{" "}
                  {!c.optional && <span className="faint">({t("gov.cookie.alwaysOn")})</span>}
                  <span className="faint" style={{ display: "block", fontSize: 12 }}>{tx(c.what, useStoreLang())}</span>
                </label>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        {/* Equal prominence: no dark pattern — reject and accept look the same */}
        <button className="btn" style={{ flex: "1 1 140px" }} onClick={() => save({ functional: false, analytics: false, marketing: false })}>
          {t("gov.cookie.rejectOptional")}
        </button>
        <button className="btn" style={{ flex: "1 1 140px" }} onClick={() => save({ functional: true, analytics: true, marketing: true })}>
          {t("gov.cookie.acceptAll")}
        </button>
        {managing ? (
          <button className="btn btn-primary" style={{ flex: "1 1 100%" }} onClick={() => save({ functional, analytics, marketing })}>
            <IcCheck size={16} /> {t("gov.cookie.save")}
          </button>
        ) : (
          <button className="btn btn-ghost" style={{ flex: "1 1 100%" }} onClick={() => setManaging(true)}>
            {t("gov.cookie.manage")}
          </button>
        )}
      </div>
    </div>
  );
}
function useStoreLang(): Lang {
  return useStore().lang;
}

/* ---------------- cookie preferences editor (settings) ---------------- */
export function CookiePrefsCard() {
  const { t, lang } = useStore();
  const { cookieConsent, setCookieConsent, clearCookieConsent } = useGov();
  const [functional, setFunctional] = useState(cookieConsent?.functional ?? true);
  const [analytics, setAnalytics] = useState(cookieConsent?.analytics ?? false);
  const [marketing, setMarketing] = useState(cookieConsent?.marketing ?? false);

  useEffect(() => {
    if (cookieConsent) {
      setFunctional(cookieConsent.functional);
      setAnalytics(cookieConsent.analytics);
      setMarketing(cookieConsent.marketing);
    }
  }, [cookieConsent]);

  return (
    <div>
      {COOKIE_CATEGORIES.map((c) => (
        <div key={c.id} className="checkbox-row">
          <input
            id={`pref-${c.id}`}
            type="checkbox"
            checked={c.optional ? (c.id === "functional" ? functional : c.id === "analytics" ? analytics : marketing) : true}
            disabled={!c.optional}
            onChange={(e) => (c.id === "functional" ? setFunctional : c.id === "analytics" ? setAnalytics : setMarketing)(e.target.checked)}
          />
          <label htmlFor={`pref-${c.id}`}>
            <strong>{tx(c.name, lang)}</strong>{" "}
            {!c.optional && <span className="faint">({t("gov.cookie.alwaysOn")})</span>}
            <span className="faint" style={{ display: "block", fontSize: 12 }}>{tx(c.what, lang)}</span>
          </label>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" onClick={() => setCookieConsent({ functional, analytics, marketing }, "settings.cookie_prefs")}>
          <IcCheck size={15} /> {t("gov.cookie.save")}
        </button>
        {cookieConsent && (
          <button className="btn btn-ghost btn-sm" onClick={clearCookieConsent}>
            {t("gov.cookie.manage")} ↺
          </button>
        )}
      </div>
      {cookieConsent && (
        <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
          {t("gov.version")} {cookieConsent.version} · {cookieConsent.region.toUpperCase()} · {new Date(cookieConsent.ts).toLocaleString()}
        </p>
      )}
    </div>
  );
}

/* ---------------- report modal ---------------- */
export function ReportModal({
  open,
  onClose,
  targetType,
  targetId,
  targetLabel,
}: {
  open: boolean;
  onClose: () => void;
  targetType: "post" | "user" | "comment" | "message" | "challenge";
  targetId: string;
  targetLabel?: string;
}) {
  const { t } = useStore();
  const { submitReport, toast } = useGov();
  const [category, setCategory] = useState<null | (typeof REPORT_CATEGORIES)[number]["id"]>(null);
  const [details, setDetails] = useState("");

  const submit = () => {
    if (!category) return;
    submitReport(targetType, targetId, category, details.trim());
    toast(t("gov.report.sent"));
    setCategory(null);
    setDetails("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`${t("gov.report.title")}${targetLabel ? ` — ${targetLabel}` : ""}`}>
      <p style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{t("gov.report.choose")}</p>
      <div role="radiogroup" aria-label={t("gov.report.choose")} style={{ display: "grid", gap: 8 }}>
        {REPORT_CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="radio"
            aria-checked={category === c.id}
            onClick={() => setCategory(c.id)}
            className="panel"
            style={{
              padding: "11px 13px",
              textAlign: "left",
              cursor: "pointer",
              borderColor: category === c.id ? "var(--gold-line)" : "var(--line)",
              background: category === c.id ? "var(--gold-soft)" : "var(--panel-2)",
              fontWeight: category === c.id ? 800 : 600,
              fontSize: 13.5,
            }}
          >
            {c.escalate && <IcShield size={14} style={{ verticalAlign: "-2px", marginRight: 6, color: "var(--gold)" }} />}
            {tx(c.label, useStoreLang())}
          </button>
        ))}
      </div>
      {category === "child_safety" && (
        <p style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "var(--gold)" }}>
          <IcShield size={13} style={{ verticalAlign: "-2px" }} /> {t("gov.report.childNote")}
        </p>
      )}
      <label className="input-label" htmlFor="rep-details" style={{ marginTop: 12 }}>
        {t("gov.report.details")} <span className="optional-tag">{t("gov.optional")}</span>
      </label>
      <textarea id="rep-details" className="input" value={details} onChange={(e) => setDetails(e.target.value)} rows={3} />
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="btn" style={{ flex: 1 }} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={!category} onClick={submit}>
          {t("gov.report.submit")}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- permission explainer sheet ---------------- */
export function PermissionGate({
  permission,
  onDone,
  children,
}: {
  permission: PermissionKey;
  onDone: () => void;
  children: ReactNode;
}) {
  const { t } = useStore();
  const { requestPermission, toast } = useGov();
  const spec = PERMISSIONS.find((p) => p.key === permission);
  const [busy, setBusy] = useState(false);
  if (!spec) return <>{children}</>;

  const proceed = async () => {
    setBusy(true);
    const result = await requestPermission(permission);
    setBusy(false);
    if (result === "denied") toast(`${tx(spec.label, useStoreLang())}: ${t("gov.perms.deniedHint")}`);
    onDone();
  };

  return (
    <Modal
      open
      onClose={onDone}
      title={tx(spec.label, useStoreLang())}
      footer={
        <>
          <button className="btn" style={{ flex: 1 }} onClick={onDone}>
            {t("gov.perms.notNow")}
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={proceed}>
            {t("gov.perms.continue")}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.65, marginBottom: 12 }}>{tx(spec.explanation, useStoreLang())}</p>
      <p className="faint" style={{ fontSize: 12.5 }}>
        {t("gov.perms.usedBy")}: {tx(spec.usedBy, useStoreLang())}
      </p>
    </Modal>
  );
}

/* ---------------- verified badge (authenticity signal) ---------------- */
export function VerifiedTag({ children }: { children: ReactNode }) {
  return (
    <span className="chip" style={{ cursor: "default", fontSize: 11.5 }}>
      <IcVerified size={12} /> {children}
    </span>
  );
}
