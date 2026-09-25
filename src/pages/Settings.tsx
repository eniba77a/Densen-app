import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, Page, Bar } from "../components/ui";
import { LinkRow, StatusPill, CookiePrefsCard, PermissionGate, tx } from "../components/gov-ui";
import { IcShield } from "../components/icons";
import { ME, useStore } from "../state/store";
import { useGov } from "../state/governance";
import { users } from "../data/store";
import { LANGS, type Lang, type TKey } from "../i18n";
import {
  bandLabel,
  CONSENT_LABELS,
  DELETION_CONSEQUENCES,
  money,
  PERMISSIONS,
  POLICY_VERSIONS,
  refundStatusNote,
  TRANSACTIONAL_EMAILS,
  type PermissionKey,
} from "../data/governance";
import { courseById } from "../data/store";
import { useAuth } from "../state/auth";

/** Day 14 — server purchase row shape (listMyPurchases projection). */
interface ServerPurchase {
  id: string;
  title: string;
  classId: string;
  amountCents: number;
  currency: string;
  provider: string;
  status: string;
  receiptState: string;
  refundStatus?: string;
  createdAt: number;
}

/** Bilingual refund-request reason labels (closed vocabulary from the core). */
const REFUND_REASON_LABELS: Record<string, { en: string; sq: string }> = {
  duplicate_purchase: { en: "Duplicate purchase", sq: "Blerje e dyfishtë" },
  accidental_purchase: { en: "Accidental purchase", sq: "Blerje aksidentale" },
  content_not_as_described: { en: "Content not as described", sq: "Përmbajtja nuk përputhej me përshkrimin" },
  technical_issue: { en: "Technical issue", sq: "Problem teknik" },
  other: { en: "Other", sq: "Tjetër" },
};

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      style={{
        width: 46, height: 27, borderRadius: 999, border: "none", cursor: disabled ? "default" : "pointer",
        position: "relative", background: on ? "var(--gold)" : "rgba(255,255,255,0.14)",
        transition: "background 0.2s ease", flexShrink: 0, opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{ position: "absolute", top: 3, left: on ? 22 : 3, width: 21, height: 21, borderRadius: "50%", background: on ? "#171204" : "#aeb5c0", transition: "left 0.2s ease" }} />
    </button>
  );
}

function Row({ label, sub, children, id }: { label: string; sub?: string; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderBottom: "1px solid var(--line)", scrollMarginTop: 80 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        {sub && <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 24, scrollMarginTop: 80 }}>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function Settings() {
  const { t, lang, setLang, settings, setSettings, toast } = useStore();
  const gov = useGov();
  const nav = useNavigate();
  const loc = useLocation();
  const [gate, setGate] = useState<PermissionKey | null>(null);
  const auth = useAuth();

  // Day 14 — signed-in users get the REAL purchase ledger (server history,
  // receipt state, refund linkage). Guests keep the local mirror preview.
  const serverPurchases = useQuery(
    api.paymentsWire.listMyPurchases,
    auth.sessionToken ? { sessionToken: auth.sessionToken } : "skip"
  );
  const requestRefundMut = useMutation(api.paymentsWire.requestRefund);
  const liveServerPurchases: ServerPurchase[] =
    serverPurchases && typeof serverPurchases === "object" && "ok" in serverPurchases && serverPurchases.ok
      ? (serverPurchases.purchases as ServerPurchase[])
      : [];

  // honor #hash anchors from the Privacy Center deep links
  useEffect(() => {
    if (loc.hash) {
      const el = document.getElementById(loc.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loc.hash]);

  const locked = gov.ageBandValue !== "adult";
  const eff = {
    privateAccount: locked ? true : settings.privateAccount,
    showLocation: locked ? false : settings.showLocation,
    messagesFrom: locked && settings.messagesFrom === "everyone" ? ("followers" as const) : settings.messagesFrom,
    allowDuet: locked ? settings.allowDuet : settings.allowDuet,
  };
  // 41/42: location = manual, typed, approximate city; never GPS; never for minors
  const [cityDraft, setCityDraft] = useState(ME.location ?? "");

  const exportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      account: { ...gov.account, dob: undefined }, // DOB is internal — exported data shows the band, not the date
      ageBand: gov.ageBandValue,
      consents: gov.consents,
      cookieConsent: gov.cookieConsent,
      emailPrefs: gov.emailPrefs,
      purchases: gov.purchases,
      refunds: gov.refunds,
      deletion: gov.deletion,
      reports: gov.reports,
      blocked: gov.blocked,
      muted: gov.muted,
      settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `densen-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(t("gov.export.btn") + " ✓");
  };

  return (
    <Page>
      <button onClick={() => nav("/profile")} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {t("common.back")}
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 20 }}>{t("settings.title")}</h1>
        <button className="chip" onClick={() => nav("/privacy")} style={{ marginBottom: 20 }}>
          🛡️ {t("gov.privacyCenter")}
        </button>
      </div>

      {/* account header */}
      <div className="panel" style={{ padding: 16, display: "flex", gap: 13, alignItems: "center", marginBottom: 8 }}>
        <Avatar src={ME.avatar} size={54} ring />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{ME.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>@{ME.username}</div>
        </div>
        <StatusPill status={locked ? "warning" : "neutral"} label={tx(bandLabel[gov.ageBandValue], lang)} />
      </div>
      <p className="faint" style={{ fontSize: 11.5, margin: "8px 2px 20px" }}>
        {t("gov.onb.dobWhy")}
      </p>

      {/* language */}
      <Section title={`🌐 ${t("settings.language")}`}>
        <p className="faint" style={{ fontSize: 12.5, margin: "-4px 0 10px" }}>{t("settings.languageSub")}</p>
        <div className="seg gold">
          {LANGS.map((l) => (
            <button key={l.code} className={lang === l.code ? "active" : ""} onClick={() => setLang(l.code as Lang)}>
              {l.label}
            </button>
          ))}
        </div>
      </Section>

      {/* account privacy */}
      <Section id="account-privacy" title={`🔒 ${t("settings.privacy")}`}>
        <div className="panel" style={{ padding: "4px 16px" }}>
          <Row label={t("settings.privateAccount")} sub={t("settings.privateAccountSub")} id="messaging">
            <Toggle on={eff.privateAccount} label={t("settings.privateAccount")} onChange={(v) => !locked && setSettings({ privateAccount: v })} />
          </Row>
          <Row label={t("settings.showLocation")} sub={locked ? t("settings.parentalSub") : undefined}>
            <Toggle on={eff.showLocation} label={t("settings.showLocation")} onChange={(v) => !locked && setSettings({ showLocation: v })} />
          </Row>
          <Row label={t("settings.allowDuet")}>
            <Toggle on={eff.allowDuet} label={t("settings.allowDuet")} onChange={(v) => setSettings({ allowDuet: v })} />
          </Row>
          <Row label={t("settings.allowMessages")}>
            <select
              className="input"
              style={{ width: 160 }}
              value={eff.messagesFrom}
              aria-label={t("settings.allowMessages")}
              onChange={(e) => setSettings({ messagesFrom: e.target.value as typeof settings.messagesFrom })}
            >
              <option value="everyone">{t("settings.everyone")}</option>
              <option value="followers">{t("settings.followersOnly")}</option>
              <option value="none">{t("settings.noOne")}</option>
            </select>
          </Row>
          <Row label={t("settings.comments")} sub={t("settings.commentsSub")}>
            <Toggle on={settings.commentFilter} label={t("settings.comments")} onChange={(v) => setSettings({ commentFilter: v })} />
          </Row>
          <Row label={t("gov.settings.locationCity")} sub={t("gov.settings.locationCitySub")}>
            <input
              className="input"
              style={{ width: 150 }}
              value={locked ? "" : cityDraft}
              placeholder={locked ? "—" : "Tirana"}
              disabled={locked}
              aria-label={t("gov.settings.locationCity")}
              onChange={(e) => setCityDraft(e.target.value)}
              onBlur={() => {
                if (!locked) toast(`${t("gov.settings.locationCity")}: ${cityDraft.trim() || "—"}`);
              }}
            />
          </Row>
        </div>
        {locked && (
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            <IcShield size={13} style={{ verticalAlign: "-2px", color: "var(--gold)" }} /> {t("settings.under16")} — {t("settings.parentalSub")}
          </p>
        )}
      </Section>

      {/* 48: parents & guardians */}
      <Section id="parents" title={`👨‍👩‍👧 ${t("gov.settings.parents")}`}>
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.7, margin: "0 0 10px" }}>{t("gov.settings.parentsSub")}</p>
          {gov.guardianName ? (
            <p style={{ fontSize: 13, margin: "0 0 8px" }}>
              ✓ {t("gov.safety.guardianLabel")}: <strong>{gov.guardianName}</strong>
            </p>
          ) : (
            <p className="faint" style={{ fontSize: 12.5, margin: "0 0 8px" }}>{t("gov.safety.guardianWhy")}</p>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink-dim)", display: "grid", gap: 5, lineHeight: 1.6 }}>
            <li>{t("gov.safety.parentsNoSurveillance")}</li>
            <li>{t("gov.safety.parentsControls")}</li>
            <li>
              <Link to="/safety" style={{ color: "var(--gold)", fontWeight: 700 }}>{t("gov.safety.center")} →</Link>
            </li>
          </ul>
        </div>
      </Section>

      {/* cookie preferences */}
      <Section title={`🍪 ${t("gov.cookie.prefsTitle")}`}>
        <div className="panel" style={{ padding: 16 }}>
          <CookiePrefsCard />
        </div>
      </Section>

      {/* permissions */}
      <Section id="permissions" title={`🔐 ${t("gov.perms.title")}`}>
        <p className="faint" style={{ fontSize: 12.5, margin: "-6px 0 10px" }}>{t("gov.perms.sub")}</p>
        <div className="panel" style={{ padding: "4px 16px" }}>
          {PERMISSIONS.map((p) => {
            const st = gov.perms[p.key] ?? "unavailable";
            return (
              <Row key={p.key} label={tx(p.label, lang)} sub={`${t("gov.perms.usedBy")}: ${tx(p.usedBy, lang)}`}>
                <button
                  className="chip"
                  onClick={() => (st === "granted" ? undefined : setGate(p.key))}
                  disabled={p.key === "contacts" || p.key === "bluetooth"}
                  style={p.key === "contacts" || p.key === "bluetooth" ? { opacity: 0.5, cursor: "default" } : undefined}
                >
                  {st === "granted" ? `✓ ${t("gov.perms.granted")}` : st === "denied" ? `✕ ${t("gov.perms.denied")}` : st === "prompt" ? t("gov.perms.prompt") : "—"}
                </button>
              </Row>
            );
          })}
        </div>
      </Section>

      {/* email preferences */}
      <Section id="email" title={`✉️ ${t("gov.email.title")}`}>
        <p className="faint" style={{ fontSize: 12.5, margin: "-6px 0 10px" }}>{t("gov.email.sub")}</p>
        <div className="panel" style={{ padding: 16 }}>
          {(
            [
              ["productUpdates", "gov.email.productUpdates"],
              ["classes", "gov.email.classes"],
              ["challenges", "gov.email.challenges"],
              ["events", "gov.email.events"],
              ["promotions", "gov.email.promotions"],
              ["teacherUpdates", "gov.email.teachers"],
            ] as [keyof typeof gov.emailPrefs, TKey][]
          ).map(([key, label]) => (
            <div key={key} className="checkbox-row">
              <input
                id={`em-${key}`}
                type="checkbox"
                checked={gov.emailPrefs[key]}
                onChange={(e) => {
                  gov.setEmailPrefs({ [key]: e.target.checked });
                  if (e.target.checked && !gov.hasConsent("marketing_email")) gov.recordConsent("marketing_email", true, "settings.email", POLICY_VERSIONS.privacy);
                }}
              />
              <label htmlFor={`em-${key}`}>{t(label)}</label>
            </div>
          ))}
          <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            ✅ {t("gov.email.transactional")} ({TRANSACTIONAL_EMAILS.length})
          </p>
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => {
              gov.setEmailPrefs({ productUpdates: false, classes: false, challenges: false, events: false, promotions: false, teacherUpdates: false });
              gov.withdrawConsent("marketing_email", "settings.email");
              toast(t("gov.email.allOff"));
            }}
          >
            {t("gov.email.unsubscribeAll")}
          </button>
        </div>
      </Section>

      {/* blocked / muted */}
      <Section id="blocked" title={`🚫 ${t("settings.muted")} & ${t("settings.blocked")}`}>
        <div className="panel" style={{ padding: "8px 16px" }}>
          {gov.blocked.length === 0 && <p className="faint" style={{ padding: "10px 0" }}>{t("gov.blockedEmpty")}</p>}
          {gov.blocked.map((id) => {
            const u = users.find((x) => x.id === id);
            return (
              <Row key={id} label={u?.name ?? id} sub={`@${u?.username ?? ""}`}>
                <button className="btn btn-sm" onClick={() => gov.toggleBlock(id)}>{t("gov.unblock")}</button>
              </Row>
            );
          })}
          {gov.muted.length === 0 && <p className="faint" style={{ padding: "10px 0 2px" }}>{t("gov.mutedEmpty")}</p>}
          {gov.muted.map((id) => {
            const u = users.find((x) => x.id === id);
            return (
              <Row key={"m" + id} label={u?.name ?? id} sub={`@${u?.username ?? ""}`}>
                <button className="btn btn-sm" onClick={() => gov.toggleMute(id)}>{t("gov.unmute")}</button>
              </Row>
            );
          })}
        </div>
      </Section>

      {/* purchases & refunds — server ledger when signed in, guest mirror otherwise */}
      <Section id="purchases" title={`💳 ${t("gov.purchases")}`}>
        {auth.sessionToken ? (
          liveServerPurchases.length === 0 ? (
            <p className="faint" style={{ fontSize: 13 }}>{t("gov.purchasesEmpty")}</p>
          ) : (
            <>
              <p className="faint" style={{ fontSize: 12, margin: "-4px 0 10px" }}>{t("pay.historySub")}</p>
              <div style={{ display: "grid", gap: 10 }}>
                {liveServerPurchases.map((p) => (
                  <div key={p.id} className="panel" style={{ padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{p.title}</div>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {new Date(p.createdAt).toLocaleDateString()} · {p.provider}
                        </div>
                        {/* Receipt state — never hides the final price or money state */}
                        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t(("pay.receiptStatus." + p.receiptState) as TKey)}</p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{money(p.amountCents, p.currency)}</div>
                        <div className="faint" style={{ fontSize: 11 }}>+ {t("gov.buy.fees")}: 0.00 {p.currency}</div>
                        <StatusPill
                          status={p.receiptState === "paid" ? "pass" : p.receiptState === "failed" || p.receiptState === "refunded" ? "action_required" : "warning"}
                          label={p.receiptState}
                        />
                      </div>
                    </div>
                    {/* Refund state comes from the server; staff review + the
                        provider move it forward — no client-side advancing. */}
                    {p.refundStatus && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                        <StatusPill
                          status={p.refundStatus === "refunded" || p.refundStatus === "approved" ? "pass" : p.refundStatus === "rejected" ? "action_required" : "warning"}
                          label={t(("pay.refundStatus." + p.refundStatus) as TKey)}
                        />
                        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{t("pay.openRequest")}</p>
                      </div>
                    )}
                    {p.receiptState === "paid" && !p.refundStatus && (
                      <RefundForm
                        onSubmit={(reason) => {
                          void requestRefundMut({ sessionToken: auth.sessionToken!, purchaseId: p.id, reason })
                            .then(() => toast(t("gov.refund.requested")))
                            .catch(() => toast(t("common.error")));
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </>
          )
        ) : gov.purchases.length === 0 ? (
          <p className="faint" style={{ fontSize: 13 }}>{t("gov.purchasesEmpty")}</p>
        ) : (
          <>
            <p className="faint" style={{ fontSize: 12, margin: "-4px 0 10px" }}>{t("pay.demoNote")}</p>
            <div style={{ display: "grid", gap: 10 }}>
              {gov.purchases.map((p) => {
                const refund = gov.refunds.find((r) => r.purchaseId === p.id);
                const course = courseById(p.courseId);
                return (
                  <div key={p.id} className="panel" style={{ padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{p.title}</div>
                        <div className="faint" style={{ fontSize: 12 }}>{course?.style} · {new Date(p.ts).toLocaleDateString()}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 800, fontSize: 14 }}>{money(p.priceCents, p.currency)}</div>
                        <div className="faint" style={{ fontSize: 11 }}>+ {t("gov.buy.fees")}: 0.00 {p.currency}</div>
                      </div>
                    </div>
                    {!refund && (
                      <RefundForm
                        onSubmit={(reason) => {
                          gov.requestRefund(p.id, reason);
                          toast(t("gov.refund.requested"));
                        }}
                      />
                    )}
                    {refund && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                        <StatusPill status={refund.status === "refunded" || refund.status === "approved" ? "pass" : refund.status === "rejected" ? "action_required" : "warning"} label={t(("gov.refund." + refund.status) as TKey)} />
                        <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>{tx(refundStatusNote(refund.status), lang)}</p>
                        {refund.status !== "refunded" && refund.status !== "rejected" && (
                          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => gov.advanceRefund(refund.id, true)}>
                            {t("gov.refund.advance")} →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Section>

      {/* consent history */}
      <Section id="consents" title={`🧾 ${t("gov.consents.title")}`}>
        <p className="faint" style={{ fontSize: 12.5, margin: "-6px 0 10px" }}>{t("gov.consents.sub")}</p>
        {gov.consents.length === 0 ? (
          <p className="faint" style={{ fontSize: 13 }}>{t("gov.consents.empty")}</p>
        ) : (
          <div className="panel" style={{ padding: "8px 16px" }}>
            {[...gov.consents].reverse().map((c) => (
              <Row
                key={c.id}
                label={tx(CONSENT_LABELS[c.type], lang)}
                sub={`${new Date(c.ts).toLocaleString()} · ${t("gov.version")} ${c.version} · ${c.region.toUpperCase()} · ${c.source}`}
              >
                <span className={`status ${c.granted ? "pass" : "warning"}`}>
                  <span aria-hidden="true">{c.granted ? "✓" : "↩"}</span>
                  {c.granted ? t("gov.consents.granted") : t("gov.consents.withdrawn")}
                </span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      {/* data & download */}
      <Section id="data" title={`📦 ${t("gov.export.title")}`}>
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{t("gov.export.sub")}</p>
          <button className="btn btn-primary btn-sm" onClick={exportData}>⬇ {t("gov.export.btn")}</button>
        </div>
      </Section>

      {/* delete account */}
      <Section id="delete" title={`🗑️ ${t("gov.del.title")}`}>
        <DeleteAccountCard />
      </Section>

      <LinkRow to="/privacy" icon="🛡️" label={t("gov.privacyCenter")} sub={t("gov.center.sub")} />
      <div style={{ height: 20 }} />

      {gate && <PermissionGate permission={gate} onDone={() => setGate(null)}>{null}</PermissionGate>}
    </Page>
  );
}

/* ---------------- refund request form (typed reasons, server vocabulary) ---------------- */
function RefundForm({ onSubmit }: { onSubmit: (reason: string) => void }) {
  const { t, lang } = useStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("duplicate_purchase");
  if (!open)
    return (
      <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        ↩️ {t("gov.refund.request")}
      </button>
    );
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
      <label className="input-label" htmlFor="refund-reason">{t("gov.refund.reason")}</label>
      <select
        id="refund-reason"
        className="input"
        value={reason}
        aria-label={t("gov.refund.reason")}
        onChange={(e) => setReason(e.target.value)}
      >
        {Object.entries(REFUND_REASON_LABELS).map(([value, label]) => (
          <option key={value} value={value}>{tx(label, lang)}</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            onSubmit(reason);
            setOpen(false);
            setReason("duplicate_purchase");
          }}
        >
          {t("gov.refund.submit")}
        </button>
      </div>
    </div>
  );
}

/* ---------------- delete account card ---------------- */
function DeleteAccountCard() {
  const { t, lang, toast } = useStore();
  const gov = useGov();
  const [confirmText, setConfirmText] = useState("");
  const [showConsequences, setShowConsequences] = useState(false);
  const del = gov.deletion;

  if (del) {
    const pct = del.status === "requested" ? 34 : del.status === "processing" ? 67 : 100;
    return (
      <div className="panel" style={{ padding: 18 }}>
        <StatusPill status={del.status === "completed" ? "pass" : "warning"} label={t(("gov.del.status." + del.status) as TKey)} />
        <div style={{ margin: "14px 0 8px" }}>
          <Bar pct={pct} />
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          {t("gov.del.coolingOff")} {tx(del.retentionNote, lang)}
        </p>
        {del.status !== "completed" && (
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={() => gov.advanceDeletion()}>{t("gov.refund.advance")} →</button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                gov.advanceDeletion();
                gov.advanceDeletion();
              }}
            >
              {t("gov.del.cancel")} (demo)
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="panel" style={{ padding: 18, borderColor: "rgba(248,113,113,0.35)" }}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{t("gov.del.retention")}</p>
      <button className="btn btn-danger" style={{ width: "100%" }} onClick={() => setShowConsequences(true)}>
        🗑️ {t("gov.del.title")}
      </button>

      {showConsequences && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14.5, marginBottom: 10 }}>{t("gov.del.what")}</h3>
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {DELETION_CONSEQUENCES.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: 13 }}>
                <span style={{ fontWeight: 800, minWidth: 110 }}>{tx(c.item, lang)}</span>
                <span className="muted">{tx(c.outcome, lang)}</span>
              </div>
            ))}
          </div>
          <label className="input-label" htmlFor="del-confirm">{t("gov.del.confirmLabel")}</label>
          <input id="del-confirm" className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" autoComplete="off" />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => setShowConsequences(false)}>{t("common.cancel")}</button>
            <button
              className="btn btn-danger"
              style={{ flex: 1 }}
              disabled={confirmText.trim().toUpperCase() !== "DELETE"}
              onClick={() => {
                if (gov.requestDeletion(confirmText)) {
                  toast(t("gov.del.requested"));
                  setShowConsequences(false);
                }
              }}
            >
              {t("gov.del.final")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { Toggle };
