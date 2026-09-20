import { useNavigate, useParams } from "react-router-dom";
import { Page, Empty } from "../components/ui";
import { LinkRow, LegalDoc, StatusPill, tx } from "../components/gov-ui";
import { useStore } from "../state/store";
import { useGov } from "../state/governance";
import {
  businessComplete,
  DOCS,
  DOC_LIST,
  REPORT_CATEGORIES,
  type DocId,
  type ReportCategory,
} from "../data/governance";
import { ME } from "../data/store";
import { IcCheck, IcShield } from "../components/icons";

/* ============================ Privacy Center ============================ */
export function PrivacyCenter() {
  const { t } = useStore();
  const { ageBandValue, deletion } = useGov();

  return (
    <Page>
      <span className="eyebrow">{t("gov.privacyCenter")}</span>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 2px" }}>{t("gov.privacyCenter")}</h1>
      <p className="muted" style={{ fontSize: 14, margin: "0 0 20px" }}>{t("gov.center.sub")}</p>

      <div className="panel" style={{ padding: "4px 16px", marginBottom: 18 }}>
        <LinkRow to="/legal/privacy" icon="📜" label={t("gov.readPrivacy")} sub={`${t("gov.version")} ${DOCS.privacy.version} · ${DOCS.privacy.effective}`} />
        <LinkRow to="/legal/terms" icon="⚖️" label={t("gov.readTerms")} sub={`${t("gov.version")} ${DOCS.terms.version} · ${DOCS.terms.effective}`} />
        <LinkRow to="/legal/cookies" icon="🍪" label={t("gov.cookie.prefsTitle")} sub={t("settings.privacy")} />
        <LinkRow to="/settings#permissions" icon="🔐" label={t("gov.perms.title")} sub={t("gov.perms.sub")} />
        <LinkRow to="/settings#account-privacy" icon="🔒" label={t("settings.privacy")} sub={t("settings.privateAccountSub")} />
        <LinkRow to="/settings#messaging" icon="💬" label={t("settings.allowMessages")} />
        <LinkRow to="/settings#data" icon="📦" label={t("gov.export.title")} sub={t("gov.export.sub")} />
        <LinkRow to="/settings#delete" icon="🗑️" label={deletion ? (t("gov.del.status.requested") + " · " + deletion.status) : t("gov.del.title")} sub={deletion?.retentionNote[useStore().lang]} />
        <LinkRow to="/settings#email" icon="✉️" label={t("gov.email.title")} sub={t("gov.unsub.sub")} />
        <LinkRow to="/settings#blocked" icon="🚫" label={t("settings.blocked")} />
        <LinkRow to="/safety" icon="🛡️" label={t("gov.safetyCenter")} sub={t("gov.safety.sub")} />
        <LinkRow to="/legal/copyright" icon="©️" label={DOCS.copyright.title[useStore().lang]} />
        <LinkRow to="/settings#consents" icon="🧾" label={t("gov.consents.title")} sub={t("gov.consents.sub")} />
      </div>

      <div className="panel" style={{ padding: 16, borderColor: "var(--gold-line)", background: "linear-gradient(120deg, rgba(227,179,65,0.08), transparent 60%), var(--panel)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
          <IcShield size={18} />
          <strong style={{ fontSize: 14 }}>{bandKey(ageBandValue) ? t("settings.under16") : t("gov.onb.protections")}</strong>
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
          {t("gov.onb.dobWhy")} {t("settings.parentalSub")}
        </p>
        <div style={{ marginTop: 12 }}>
          <LinkRow to="/settings" icon="⚙️" label={t("settings.title")} />
        </div>
      </div>
    </Page>
  );
}
const bandKey = (b: string) => b !== "adult";

/* ============================ Legal document pages ============================ */
export function LegalPage() {
  const { docId } = useParams();
  const nav = useNavigate();
  const valid = DOC_LIST.includes(docId as DocId);
  if (!valid) return <Page><Empty icon="📜" text="Document not found" /></Page>;
  return (
    <Page>
      <button onClick={() => nav(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {useStore().t("common.back")}
      </button>
      <LegalDoc id={docId as DocId} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 24 }}>
        {DOC_LIST.filter((d) => d !== docId).map((d) => (
          <button key={d} className="chip" onClick={() => nav(`/legal/${d}`)}>{DOCS[d].title[useStore().lang]}</button>
        ))}
      </div>
    </Page>
  );
}

/* ============================ Safety Center ============================ */
export function SafetyCenter() {
  const { t, lang } = useStore();
  const { submitReport, toast } = useGov();

  const quick = (category: ReportCategory) => {
    submitReport("user", ME.id, category, "Opened from Safety Center");
    toast(t("gov.report.sent"));
  };

  return (
    <Page>
      <span className="eyebrow">{t("gov.safetyCenter")}</span>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 2px" }}>🛡️ {t("gov.safetyCenter")}</h1>
      <p className="muted" style={{ fontSize: 14, margin: "0 0 20px" }}>{t("gov.safety.sub")}</p>

      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>🚨 {t("gov.safety.report")}</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          {t("gov.report.childNote")}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {REPORT_CATEGORIES.slice(0, 4).map((c) => (
            <button key={c.id} className="chip" onClick={() => quick(c.id)}>🚩 {tx(c.label, lang)}</button>
          ))}
        </div>
      </div>

      <div className="panel" style={{ padding: "4px 16px", marginBottom: 14 }}>
        <LinkRow to="/legal/community" icon="🤝" label={DOCS.community.title[lang]} sub={`${t("gov.version")} ${DOCS.community.version}`} />
        <LinkRow to="/legal/copyright" icon="©️" label={DOCS.copyright.title[lang]} />
        <LinkRow to="/challenges" icon="🏆" label={t("gov.safety.reportChallenge")} sub={t("gov.safety.reportChallengeSub")} />
        <LinkRow to="/settings#blocked" icon="🚫" label={t("settings.blocked")} sub={t("settings.report")} />
        <LinkRow to="/settings#messaging" icon="💬" label={t("safety.messaging")} sub={t("safety.messagingSub")} />
        <LinkRow to="/account" icon="🔑" label={t("safety.acctsec")} sub={t("safety.acctsecSub")} />
        <LinkRow to="/settings#permissions" icon="🔐" label={t("gov.perms.title")} />
        <LinkRow to="/business" icon="🏢" label={t("gov.businessInfo")} />
      </div>

      <div className="panel" style={{ padding: 18, borderColor: "var(--gold-line)" }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>👨‍👩‍👧 {t("gov.safety.parents")}</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 10 }}>{t("gov.safety.parentsSub")}</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-dim)", display: "grid", gap: 6, lineHeight: 1.6 }}>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> <strong>{bandLabelRow()}</strong> — {t("settings.parentalSub")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("settings.allowMessages")}: {t("settings.followersOnly")} / {t("settings.noOne")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("settings.allowDuet")} — {t("settings.followersOnly")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("settings.showLocation")}: {t("gov.disabled")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("settings.comments")}: {t("gov.enabled")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("gov.email.promotions")}: {t("gov.disabled")} — {t("gov.email.transactional")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("gov.safety.guardianWhy")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("gov.safety.parentsNoSurveillance")}</li>
          <li><IcCheck size={13} style={{ verticalAlign: "-1px", color: "var(--ok)" }} /> {t("gov.safety.parentsControls")}</li>
        </ul>
        <LinkRow to="/settings#parents" icon="⚙️" label={t("gov.settings.parents")} sub={t("gov.settings.parentsSub")} />
      </div>
    </Page>
  );
}
function bandLabelRow() {
  return "Under-16 protections";
}

/* ============================ Business information ============================ */
export function BusinessPage() {
  const { t, lang } = useStore();
  const { business } = useGov();
  const complete = businessComplete(business);

  const field = (label: string, value?: string) => (
    <div style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
      <span className="faint" style={{ fontSize: 12.5, width: 170, flexShrink: 0 }}>{label}</span>
      {value ? <strong style={{ fontSize: 13.5 }}>{value}</strong> : <em className="faint" style={{ fontSize: 12.5 }}>—</em>}
    </div>
  );

  return (
    <Page>
      <span className="eyebrow">{t("gov.legal")}</span>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 2px" }}>🏢 {t("gov.businessInfo")}</h1>
      <p className="muted" style={{ fontSize: 14, margin: "0 0 18px" }}>{t("gov.biz.editIn")}</p>

      {!complete && (
        <div className="panel" style={{ padding: 14, marginBottom: 16, borderColor: "var(--gold-line)", background: "var(--gold-soft)" }}>
          <StatusPill status="warning" label={t("gov.warning")} />{" "}
          <span style={{ fontSize: 13 }}>{t("gov.biz.unpublished")}</span>
        </div>
      )}

      <div className="panel" style={{ padding: "8px 16px", marginBottom: 16 }}>
        {field(t("gov.biz.legalName"), business.legalName)}
        {field(t("gov.biz.address"), business.address)}
        {field(t("gov.biz.contact"), business.contactEmail)}
        {field(t("gov.biz.support"), business.supportEmail)}
        {field(t("gov.biz.registration"), business.registration)}
        {field(t("gov.biz.vat"), business.vat)}
      </div>

      <div className="panel" style={{ padding: "4px 16px" }}>
        <LinkRow to="/legal/terms" icon="⚖️" label={t("gov.readTerms")} />
        <LinkRow to="/legal/privacy" icon="📜" label={t("gov.readPrivacy")} />
        <LinkRow to="/legal/refunds" icon="↩️" label={DOCS.refunds.title[lang]} />
      </div>
    </Page>
  );
}

/* ============================ Unsubscribe landing (email link target) ============================ */
export function UnsubscribePage() {
  const { t } = useStore();
  const { emailPrefs, setEmailPrefs, withdrawConsent, toast } = useGov();
  const allOn = Object.values(emailPrefs).some(Boolean);

  return (
    <Page>
      <span className="eyebrow">{t("gov.email.title")}</span>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 2px" }}>✉️ {t("gov.unsub.title")}</h1>
      <p className="muted" style={{ fontSize: 14, margin: "0 0 18px" }}>{t("gov.unsub.sub")}</p>

      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        {allOn ? (
          <button
            className="btn btn-primary"
            style={{ width: "100%", minHeight: 48 }}
            onClick={() => {
              setEmailPrefs({ productUpdates: false, classes: false, challenges: false, events: false, promotions: false, teacherUpdates: false });
              withdrawConsent("marketing_email", "unsubscribe_page");
              toast(t("gov.email.allOff"));
            }}
          >
            {t("gov.email.unsubscribeAll")}
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusPill status="pass" label={t("gov.email.allOff")} />
          </div>
        )}
        <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
          ✅ {t("gov.email.transactional")}: purchase_confirmation · password_reset · security_alert · account_deletion_confirmation
        </p>
      </div>

      <button className="btn btn-ghost" onClick={() => window.history.back()}>← {t("common.back")}</button>
    </Page>
  );
}
