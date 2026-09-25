import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Page, StatCard } from "../components/ui";
import { StatusPill, tx } from "../components/gov-ui";
import { useStore } from "../state/store";
import { useGov } from "../state/governance";
import { useAuth } from "../state/auth";
import { api } from "../../convex/_generated/api";
import { courses, fmt, users } from "../data/store";
import {
  CLAIM_FLOW_LABELS as CLAIM_FLOW_STEPS,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  MUSIC_STATUS_LABELS,
} from "../lib/musicRightsClient";
import {
  CONSENT_LABELS,
  DATA_INVENTORY,
  money,
  collectMarketedStrings,
  contrastAudit,
  scanClaims,
  THIRD_PARTY,
  type ChecklistItem,
  type ConsentType,
} from "../data/governance";
import {
  AUDIT_LABELS,
  canViewEvent,
  evaluateContactPattern,
  isVerifiedTeacher,
  ROLE_PERMS,
  SECURITY_CONTROLS,
  STAFF_ROLE_LABELS,
  TEACHER_VERIFICATIONS,
  youthAuditItems,
  type StaffRole,
} from "../data/safety";

type AdminTab =
  | "overview"
  | "users"
  | "content"
  | "moderation"
  | "revenue"
  | "compliance"
  | "legal"
  | "safety"
  | "trust"
  | "copyright"
  | "sdk"
  | "a11y"
  | "claims"
  | "inventory"
  | "business"
  | "requests";

const SEED_REPORTS = [
  { id: "sr1", type: "Video", target: "@luca.v — salsa footwork drill", reason: "Music copyright claim", time: "24m", priority: "high" },
  { id: "sr2", type: "Comment", target: "@noarocks video", reason: "Offensive language", time: "1h", priority: "high" },
  { id: "sr3", type: "User", target: "@spam.dancer99", reason: "Spam / fake account", time: "3h", priority: "normal" },
  { id: "sr4", type: "Challenge entry", target: "30 Day Hip Hop", reason: "Reposted from TikTok", time: "6h", priority: "normal" },
];

const TABS: [AdminTab, string][] = [
  ["overview", "📈 Overview"],
  ["moderation", "🛡️ Moderation"],
  ["safety", "🚨 Safety"],
  ["trust", "🧒 Child Safety & Trust"],
  ["compliance", "✅ Compliance"],
  ["legal", "⚖️ Legal"],
  ["copyright", "©️ Copyright & assets"],
  ["sdk", "🔌 Third-party"],
  ["a11y", "♿ Accessibility"],
  ["claims", "🔍 Claims"],
  ["inventory", "🗂️ Data inventory"],
  ["requests", "📨 Requests"],
  ["business", "🏢 Business"],
  ["users", "👥 Users"],
  ["content", "🎬 Content"],
  ["revenue", "💰 Revenue"],
];

export default function Admin() {
  const { t, lang, toast } = useStore();
  const gov = useGov();
  const auth = useAuth();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [reports, setReports] = useState(SEED_REPORTS);
  const [bizDraft, setBizDraft] = useState(gov.business);
  const [unlocked, setUnlocked] = useState(false);
  const setRole = (r: StaffRole) => gov.setStaffRole(r);

  const resolve = (id: string) => setReports((rs) => rs.filter((r) => r.id !== id));

  // Role-based gate: sensitive governance tabs require the Compliance Admin role.
  const sensitive: AdminTab[] = ["legal", "safety", "copyright", "claims", "inventory", "requests"];
  const needsGate = sensitive.includes(tab) && !unlocked;

  const check = (c: ChecklistItem) => (
    <div key={c.id} className="panel" style={{ padding: 14, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>{tx(c.label, lang)}</strong>
        <StatusPill status={c.status} />
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>{tx(c.detail, lang)}</p>
    </div>
  );

  const audit = gov.audit();

  return (
    <Page wide>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>🛡️ {t("gov.admin.title")}</h1>
          <p className="muted" style={{ margin: "0 0 20px", fontSize: 14 }}>{t("admin.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
          <label className="faint" htmlFor="role-select" style={{ fontSize: 12 }}>{t("gov.admin.roleSelect")}:</label>
          <select
            id="role-select"
            className="input"
            style={{ width: 190, padding: "7px 10px" }}
            value={gov.staffRole}
            onChange={(e) => setRole(e.target.value as StaffRole)}
          >
            {(Object.keys(STAFF_ROLE_LABELS) as StaffRole[]).map((r) => (
              <option key={r} value={r}>{tx(STAFF_ROLE_LABELS[r], lang)}</option>
            ))}
          </select>
          {!unlocked && (
            <button className="btn btn-sm btn-primary" onClick={() => setUnlocked(true)}>
              🔓 {t("gov.admin.gate")}
            </button>
          )}
        </div>
      </div>

      {/* audit summary strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <span className="status pass"><span aria-hidden>✓</span> {gov.auditStatusCounts.pass} {t("gov.pass")}</span>
        <span className="status warning"><span aria-hidden>!</span> {gov.auditStatusCounts.warning} {t("gov.warning")}</span>
        <span className="status action_required"><span aria-hidden>✕</span> {gov.auditStatusCounts.action_required} {t("gov.action")}</span>
        <span className="faint" style={{ fontSize: 12, alignSelf: "center" }}>{t("gov.computedNote")}</span>
      </div>

      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 20 }}>
        {TABS.map(([id, label]) => (
          <button key={id} className={`chip${tab === id ? " active" : ""}`} onClick={() => setTab(id)} aria-pressed={tab === id}>
            {label}
            {id === "moderation" && reports.length > 0 ? ` (${reports.length})` : ""}
          </button>
        ))}
      </div>

      {needsGate ? (
        <div className="panel" style={{ padding: 30, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🔐</div>
          <p style={{ fontWeight: 800, marginBottom: 6 }}>{t("gov.admin.gate")}</p>
          <p className="faint" style={{ fontSize: 13, marginBottom: 14 }}>{t("gov.admin.role")}</p>
          <button className="btn btn-primary" onClick={() => setUnlocked(true)}>🔓 {t("gov.perms.continue")}</button>
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
                <StatCard icon="👥" value="128,400" label={t("admin.totalUsers")} accent />
                <StatCard icon="🟢" value="31,240" label={t("admin.activeUsers")} />
                <StatCard icon="✨" value="2,860" label={t("admin.newUsers")} />
                <StatCard icon="🎥" value="412,000" label={t("admin.videosUploaded")} />
                <StatCard icon="📚" value="1,840,000" label={t("admin.classesWatched")} />
                <StatCard icon="🎓" value="96,200" label={t("admin.coursesCompleted")} />
                <StatCard icon="🚩" value={String(reports.length + gov.reports.length)} label={t("admin.reports")} />
                <StatCard icon="🗑️" value={gov.deletion ? 1 : 0} label={t("gov.admin.deletionQueue")} />
              </div>
              <div className="panel" style={{ padding: 18 }}>
                <h2 style={{ fontSize: 15, marginBottom: 12 }}>✅ {t("gov.compliance")} — {t("gov.computedNote")}</h2>
                {audit.slice(0, 6).map(check)}
                <button className="btn btn-sm" onClick={() => setTab("compliance")}>{t("common.seeAll")} →</button>
              </div>
            </>
          )}

          {tab === "moderation" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[...gov.reports.map((r) => ({ id: r.id, type: r.targetType, target: r.targetId, reason: r.category, time: new Date(r.ts).toLocaleString(), priority: r.category === "child_safety" ? "critical" : "high", live: true as const })),
                ...reports.map((r) => ({ ...r, live: false as const }))]
                .sort((a, b) => (a.priority === "critical" ? -1 : b.priority === "critical" ? 1 : a.priority === "high" ? -1 : b.priority === "high" ? 1 : 0))
                .map((r) => (
                  <div key={r.id} className="panel" style={{ padding: 14, display: "flex", gap: 13, alignItems: "center", flexWrap: "wrap", borderColor: r.priority === "critical" ? "rgba(248,113,113,0.5)" : undefined }}>
                    <span style={{ fontSize: 22 }} aria-hidden>{r.priority === "critical" ? "🚨" : "🚩"}</span>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                        {r.type} · {r.target} {r.live && <span className="status neutral" style={{ marginLeft: 6 }}>user</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{r.reason} · {r.time}</div>
                    </div>
                    <StatusPill status={r.priority === "critical" ? "action_required" : "warning"} label={r.priority === "critical" ? t("gov.report.childNote").split(" ").slice(0, 2).join(" ") : r.priority} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-sm btn-primary" onClick={() => (r.live ? gov.resolveReport(r.id) : resolve(r.id))}>✓ {t("admin.resolve")}</button>
                      <button className="btn btn-sm" onClick={() => (r.live ? gov.resolveReport(r.id) : resolve(r.id))}>{t("admin.dismiss")}</button>
                    </div>
                  </div>
                ))}
              {reports.length === 0 && gov.reports.length === 0 && (
                <div className="panel" style={{ padding: 30, textAlign: "center" }}>
                  <div style={{ fontSize: 34, marginBottom: 8 }}>🛡️</div>
                  <p className="muted" style={{ margin: 0 }}>{t("gov.admin.noOpenReports")}</p>
                </div>
              )}
            </div>
          )}

          {tab === "safety" && (
            <>
              <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>🚨 Child-safety escalation queue</h2>
                <p className="faint" style={{ fontSize: 12.5, marginBottom: 12 }}>{t("gov.report.childNote")}</p>
                {gov.reports.filter((r) => r.category === "child_safety" || r.category === "harassment" || r.category === "bullying" || r.category === "dangerous_challenge").length === 0 ? (
                  <p className="faint" style={{ fontSize: 13 }}>{t("gov.admin.noOpenReports")}</p>
                ) : (
                  gov.reports
                    .filter((r) => ["child_safety", "harassment", "bullying", "dangerous_challenge"].includes(r.category))
                    .map((r) => (
                      <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                        <StatusPill status={r.category === "child_safety" ? "action_required" : "warning"} label={r.category} />
                        <span style={{ fontSize: 13, flex: 1 }}>{r.targetType} · {r.targetId} {r.details && `— ${r.details}`}</span>
                        <button className="btn btn-sm" onClick={() => gov.resolveReport(r.id)}>{t("admin.resolve")}</button>
                      </div>
                    ))
                )}
              </div>
              <div className="panel" style={{ padding: 16 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>👑 Minor accounts (stronger moderation)</h2>
                {users.filter((u) => u.minor).map((u) => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                    <img src={u.avatar} alt={`Profile photo of ${u.name}, teenage dancer`} style={{ width: 34, height: 34, borderRadius: "50%" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u.name}</div>
                      <div className="faint" style={{ fontSize: 11.5 }}>@{u.username}</div>
                    </div>
                    <span className="status warning"><span aria-hidden>🛡</span> protected</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "trust" && <TrustDashboard />}

          {tab === "compliance" && (
            <>
              <p className="faint" style={{ fontSize: 13, margin: "0 0 14px" }}>{t("gov.computedNote")}</p>
              {audit.map(check)}
              {youthAuditItems({ auditEvents: gov.auditEvents, contactAttempts: gov.contactAttempts }).map(check)}
            </>
          )}

          {tab === "legal" && (
            <>
              <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>📜 {t("gov.admin.consentRecords")} ({gov.consents.length})</h2>
                {gov.consents.length === 0 ? (
                  <p className="faint" style={{ fontSize: 13 }}>{t("gov.consents.empty")}</p>
                ) : (
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {[...gov.consents].reverse().map((c) => (
                      <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap", fontSize: 12.5 }}>
                        <span className={`status ${c.granted ? "pass" : "warning"}`}><span aria-hidden>{c.granted ? "✓" : "↩"}</span>{c.granted ? t("gov.consents.granted") : t("gov.consents.withdrawn")}</span>
                        <strong>{tx(CONSENT_LABELS[c.type as ConsentType], lang)}</strong>
                        <span className="faint">{new Date(c.ts).toLocaleString()} · v{c.version} · {c.region.toUpperCase()} · {c.source}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="panel" style={{ padding: 16 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>🍪 Cookie consent</h2>
                {gov.cookieConsent ? (
                  <p style={{ fontSize: 13, lineHeight: 1.7 }}>
                    functional: <strong>{String(gov.cookieConsent.functional)}</strong> · analytics: <strong>{String(gov.cookieConsent.analytics)}</strong> · marketing: <strong>{String(gov.cookieConsent.marketing)}</strong>
                    <br /><span className="faint" style={{ fontSize: 12 }}>v{gov.cookieConsent.version} · {gov.cookieConsent.region.toUpperCase()} · {new Date(gov.cookieConsent.ts).toLocaleString()}</span>
                  </p>
                ) : (
                  <p className="faint" style={{ fontSize: 13 }}>—</p>
                )}
              </div>
            </>
          )}

          {tab === "copyright" && <CopyrightDashboard sessionToken={auth.sessionToken} />}

          {tab === "sdk" && (
            <div className="panel" style={{ padding: "8px 16px" }}>
              {THIRD_PARTY.map((s) => (
                <div key={s.provider} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13.5 }}>{s.provider}</strong>
                    <StatusPill status={s.enabled ? "pass" : "neutral"} label={s.enabled ? t("gov.enabled") : t("gov.planned")} />
                  </div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
                    {tx(s.purpose, lang)}<br />
                    {t("gov.required")}: {String(s.required)} · {tx(s.region, lang)} · v{s.version}<br />
                    <a href={s.privacyUrl} target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>{s.privacyUrl}</a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "a11y" && (
            <>
              <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>🎨 Contrast audit (WCAG AA)</h2>
                {contrastAudit().map((c) => (
                  <div key={c.fg + c.bg} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 6, background: c.bg, border: "1px solid var(--line)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: c.fg, fontSize: 11, fontWeight: 800 }}>Aa</span>
                    </span>
                    <span style={{ fontSize: 12.5, flex: 1 }}>{tx(c.use, lang)} — {c.fg} on {c.bg}</span>
                    <StatusPill status={c.passesAA ? "pass" : "action_required"} label={`${c.ratio}:1${c.passesAAA ? " AAA" : ""}`} />
                  </div>
                ))}
              </div>
              <div className="panel" style={{ padding: 16 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>♿ Implemented</h2>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-dim)", display: "grid", gap: 6, lineHeight: 1.6 }}>
                  <li>:focus-visible rings on every interactive element; skip-link to main content</li>
                  <li>Modals trap Tab focus, close on Escape, restore focus to the opener</li>
                  <li>Alt text from contextual templates; decorative images use empty alt</li>
                  <li>Status never color-only — every pill pairs icon + text</li>
                  <li>prefers-reduced-motion disables animations</li>
                  <li>44px minimum touch targets; logical DOM order for screen readers</li>
                </ul>
              </div>
            </>
          )}

          {tab === "claims" && (
            <>
              <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>🔍 {t("gov.admin.claims")} — live copy scan</h2>
                {(() => {
                  const hits = collectMarketedStrings().map((s) => ({ s, hits: scanClaims(s) })).filter((x) => x.hits.length > 0);
                  return hits.length === 0 ? (
                    <p className="muted" style={{ fontSize: 13 }}>
                      <StatusPill status="pass" label={t("gov.admin.noFlaggedClaims")} />
                    </p>
                  ) : (
                    hits.map((h, i) => (
                      <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                        <StatusPill status="warning" label={t("gov.admin.requiresVerification")} />
                        <p style={{ fontSize: 13, marginTop: 6 }}>“{h.s.slice(0, 140)}”</p>
                        <p className="faint" style={{ fontSize: 12 }}>{h.hits.map((x) => tx(x.pattern, lang)).join(" · ")}</p>
                      </div>
                    ))
                  );
                })()}
              </div>
              <div className="panel" style={{ padding: 16 }}>
                <h2 style={{ fontSize: 15, marginBottom: 8 }}>📏 Rules</h2>
                <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
                  Superlatives (“best”, “#1”), guarantees (“guaranteed results”), absolute safety/copyright claims and invented statistics are flagged for evidence review before publication. No fabricated student numbers, reviews or teacher credentials anywhere in Densen.
                </p>
              </div>
            </>
          )}

          {tab === "inventory" && (
            <div className="panel" style={{ padding: "8px 16px" }}>
              {DATA_INVENTORY.map((e) => (
                <div key={e.data.en} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13.5 }}>{tx(e.data, lang)}</strong>
                    <StatusPill status={e.required === true ? "neutral" : "warning"} label={e.required === true ? t("gov.required") : e.required === "conditional" ? "conditional" : t("gov.optional")} />
                  </div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.7 }}>
                    → {tx(e.purpose, lang)}<br />
                    ⏳ {tx(e.retention, lang)}<br />
                    👁 {tx(e.access, lang)}<br />
                    🗑 {tx(e.deletion, lang)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "requests" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="panel" style={{ padding: 16 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>↩️ {t("gov.admin.refundQueue")}</h2>
                {gov.refunds.length === 0 ? <p className="faint" style={{ fontSize: 13 }}>—</p> : gov.refunds.map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13 }}>{gov.purchases.find((p) => p.id === r.purchaseId)?.title ?? r.purchaseId}</strong>
                    <StatusPill status={r.status === "refunded" ? "pass" : r.status === "rejected" ? "action_required" : "warning"} label={t(("gov.refund." + r.status) as never)} />
                    <span className="faint" style={{ fontSize: 12, flex: 1 }}>{r.reason}</span>
                    {r.status !== "refunded" && r.status !== "rejected" && (
                      <button className="btn btn-sm" onClick={() => gov.advanceRefund(r.id, true)}>→</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="panel" style={{ padding: 16 }}>
                <h2 style={{ fontSize: 15, marginBottom: 10 }}>🗑️ {t("gov.admin.deletionQueue")}</h2>
                {gov.deletion ? (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <StatusPill status={gov.deletion.status === "completed" ? "pass" : "warning"} label={t(("gov.del.status." + gov.deletion.status) as never)} />
                    <span className="faint" style={{ fontSize: 12 }}>{new Date(gov.deletion.ts).toLocaleString()} · {gov.deletion.id}</span>
                    <button className="btn btn-sm" onClick={() => gov.advanceDeletion()}>→</button>
                  </div>
                ) : (
                  <p className="faint" style={{ fontSize: 13 }}>—</p>
                )}
              </div>
            </div>
          )}

          {tab === "business" && (
            <div className="panel" style={{ padding: 18, maxWidth: 560 }}>
              <h2 style={{ fontSize: 15, marginBottom: 12 }}>🏢 {t("gov.businessInfo")}</h2>
              {([
                ["legalName", t("gov.biz.legalName")],
                ["address", t("gov.biz.address")],
                ["contactEmail", t("gov.biz.contact")],
                ["supportEmail", t("gov.biz.support")],
                ["registration", t("gov.biz.registration")],
                ["vat", t("gov.biz.vat")],
              ] as [keyof typeof bizDraft, string][]).map(([key, label]) => (
                <div key={key} style={{ marginBottom: 12 }}>
                  <label className="input-label" htmlFor={`biz-${key}`}>{label}</label>
                  <input id={`biz-${key}`} className="input" value={bizDraft[key]} onChange={(e) => setBizDraft({ ...bizDraft, [key]: e.target.value })} />
                </div>
              ))}
              <button
                className="btn btn-primary"
                onClick={() => {
                  gov.updateBusiness(bizDraft);
                  toast(t("gov.admin.saved"));
                }}
              >
                {t("gov.admin.save")}
              </button>
              <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>{t("gov.biz.unpublished")}</p>
            </div>
          )}

          {tab === "users" && (
            <div className="panel" style={{ padding: "8px 16px" }}>
              {[...users, users[0], users[1]].map((u, i) => (
                <div key={u.id + i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                  <img src={u.avatar} alt={`Profile photo of ${u.name}${u.teacher ? ", teacher" : ""}`} style={{ width: 36, height: 36, borderRadius: "50%" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{u.name} {u.teacher && "⭐"}</div>
                    <div className="faint" style={{ fontSize: 11.5 }}>@{u.username} · {fmt(u.followers)} followers</div>
                  </div>
                  <span className="chip" style={{ fontSize: 10.5 }}>{u.minor ? "Minor · protected" : u.teacher ? "Teacher" : "Dancer"}</span>
                </div>
              ))}
            </div>
          )}

          {tab === "content" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {courses.map((c) => (
                <div key={c.id} className="panel" style={{ overflow: "hidden" }}>
                  <img src={c.cover} alt={`Cover: dancer performing ${c.style.toLowerCase()} choreography for the course ${c.title}`} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover" }} />
                  <div style={{ padding: "11px 13px" }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.title}</div>
                    <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                      {c.lessons.length} lessons · {fmt(c.enrolled)} enrolled
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "revenue" && (
            <>
              <RefundQueue sessionToken={auth.sessionToken} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
                <StatCard icon="💰" value="€84,120" label="MRR" accent />
                <StatCard icon="💳" value="24,890" label={t("admin.subscriptions")} />
                <StatCard icon="📊" value="€3.38" label="ARPU" />
                <StatCard icon="📉" value="2.1%" label="Churn" />
              </div>
              <div className="panel" style={{ padding: 18 }}>
                <h2 style={{ fontSize: 15, marginBottom: 14 }}>💳 Plans</h2>
                {[
                  ["Densen Free", "82,410 users", 76],
                  ["Densen Pro (€9.99/mo)", "21,340 users", 19],
                  ["Densen Family", "3,550 users", 5],
                ].map(([plan, n, pct]) => (
                  <div key={plan as string} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 5 }}>
                      <span>{plan}</span>
                      <span className="muted">{n}</span>
                    </div>
                    <div className="bar"><span style={{ width: `${pct}%` }} /></div>
                  </div>
                ))}
                <p className="faint" style={{ fontSize: 12, marginTop: 10 }}>
                  {t("gov.buy.demo")} · {money(800)} {t("gov.buy.fees")}: 0.00 EUR
                </p>
              </div>
            </>
          )}
        </>
      )}
    </Page>
  );
}

/* ==================== DAY 13: LIVE COPYRIGHT DASHBOARD ==================== */

/** Shape projected by musicRightsWire.adminCopyrightDashboard.flaggedRecords. */
interface MusicRecordProjection {
  title: string;
  artist: string;
  audioId: string;
  rightsHolder: string;
  licensingStatus: string;
  territories: string[];
  permittedUse: string[];
  commercialUse: boolean;
  maxDurationSec?: number;
  licenseExpiresAt?: number;
  fingerprintRef?: string;
  restrictions?: string;
}

interface AdminClaim {
  id: string;
  audioId: string;
  postId?: string;
  affectedUserId?: string;
  source: string;
  claimantName: string;
  assertion: string;
  status: string;
  fingerprintRef?: string;
  createdAt: number;
}
interface AdminDispute {
  id: string;
  claimId: string;
  reason: string;
  statement: string;
  evidenceRefs: string[];
  status: string;
  createdAt: number;
}

/* ==================== 14: REFUND QUEUE (staff) ==================== */

const REFUND_REQUEST_REASON_LABELS: Record<string, { en: string; sq: string }> = {
  duplicate_purchase: { en: "Duplicate purchase", sq: "Blerje e dyfishtë" },
  accidental_purchase: { en: "Accidental purchase", sq: "Blerje aksidentale" },
  content_not_as_described: { en: "Content not as described", sq: "Përmbajtja nuk përputhej me përshkrimin" },
  technical_issue: { en: "Technical issue", sq: "Problem teknik" },
  other: { en: "Other", sq: "Tjetër" },
};

/**
 * Day 14 — staff refund queue over the REAL refundRequests ledger.
 * Approving moves the request toward the provider; the money itself moves
 * only when the provider's refund event lands. Rejecting needs no provider.
 */
function RefundQueue({ sessionToken }: { sessionToken: string | null }) {
  const { t, lang, toast } = useStore();
  const queue = useQuery(
    api.paymentsWire.adminRefundQueue,
    sessionToken ? ({ sessionToken } as never) : "skip"
  );
  const review = useMutation(api.paymentsWire.reviewRefundRequest);

  if (!sessionToken) {
    return (
      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>↩️ Refund queue</h2>
        <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Sign in as staff to review refund requests.</p>
      </div>
  );
  }
  const rows = queue && typeof queue === "object" && "ok" in queue && queue.ok ? queue.queue : [];
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, marginBottom: 8 }}>↩️ Refund queue ({rows.length})</h2>
      <p className="faint" style={{ fontSize: 12, marginBottom: 10 }}>
        Approving queues the refund with the payment provider — money moves only on the provider's confirmed refund event.
      </p>
      {rows.length === 0 && <p className="faint" style={{ fontSize: 13 }}>—</p>}
      {rows.map((r: { id: string; userId: string; reason: string; status: string; detail?: string; purchaseId: string; amountCents?: number; currency?: string; createdAt: number }) => (
        <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <StatusPill
              status={r.status === "refunded" || r.status === "approved" ? "pass" : r.status === "rejected" ? "action_required" : "warning"}
              label={r.status.replace("_", " ")}
            />
            <strong style={{ fontSize: 13 }}>
              {r.amountCents !== undefined ? money(r.amountCents, r.currency ?? "EUR") : "—"}
            </strong>
            <span style={{ fontSize: 12.5 }}>{tx(REFUND_REQUEST_REASON_LABELS[r.reason] ?? { en: r.reason, sq: r.reason }, lang)}</span>
            <span className="faint" style={{ fontSize: 11.5 }}>{new Date(r.createdAt).toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {r.status === "requested" && (
              <button
                className="btn btn-sm"
                onClick={() => void review({ sessionToken: sessionToken!, refundId: r.id, approve: true }).catch(() => toast(t("common.error")))}
              >
                🔍 Review
              </button>
            )}
            {(r.status === "requested" || r.status === "under_review") && (
              <>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void review({ sessionToken: sessionToken!, refundId: r.id, approve: true }).catch(() => toast(t("common.error")))}
                >
                  ✓ Approve → provider
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => void review({ sessionToken: sessionToken!, refundId: r.id, approve: false }).catch(() => toast(t("common.error")))}
                >
                  ✕ Reject
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CopyrightDashboard({ sessionToken }: { sessionToken: string | null }) {
  const { lang } = useStore();
  const dash = useQuery(
    api.musicRightsWire.adminCopyrightDashboard,
    sessionToken ? ({ sessionToken } as never) : "skip"
  );
  const audit = useQuery(
    api.musicRightsWire.adminRightsAudit,
    sessionToken ? ({ sessionToken, limit: 20 } as never) : "skip"
  );
  const advance = useMutation(api.musicRightsWire.advanceClaim);
  const review = useMutation(api.musicRightsWire.reviewDispute);

  if (!sessionToken) {
    return (
      <div className="panel" style={{ padding: 16 }}>
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>🛡 {lang === "sq" ? "Hyr si staf për të parë rreshtat e të drejtave të autorit." : "Sign in as staff to view the live copyright rows."}</p>
      </div>
    );
  }

  const claims: AdminClaim[] = dash?.ok ? dash.claims : [];
  const disputes: AdminDispute[] = dash?.ok ? dash.disputes : [];
  const flaggedRecords: (MusicRecordProjection & { id: string })[] = dash?.ok ? dash.flaggedRecords : [];
  const counts = dash?.ok ? dash.counts : { claims: 0, disputes: 0, flaggedRecords: 0 };
  const err = dash && !dash.ok ? dash.error : undefined;

  return (
    <>
      {err === "forbidden" && (
        <p className="faint" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
          {lang === "sq" ? "Rreshtat e drejta jetojnë për stafin (moderator+)." : "Rights rows are live for staff (moderator+) accounts."}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard icon="©️" value={String(counts.claims)} label={lang === "sq" ? "Pretendime aktive" : "Open claims"} accent />
        <StatCard icon="⚖️" value={String(counts.disputes)} label={lang === "sq" ? "Kundërshtime" : "Disputes"} />
        <StatCard icon="🚫" value={String(counts.flaggedRecords)} label={lang === "sq" ? "Këngë të shënuara" : "Flagged tracks"} />
      </div>

      {/* claim queue with the flow actions the brief requires */}
      <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>©️ {lang === "sq" ? "Radha e pretendimeve" : "Copyright claim queue"} ({claims.length})</h2>
        <p className="faint" style={{ fontSize: 12, margin: "0 0 10px", lineHeight: 1.6 }}>
          {lang === "sq"
            ? "Rrjedha: marrje → njoftim → kufizim → zëvendëso audio → heq audio → heq përmbajtje. Vendosja nuk bëhet kurrë automatikisht — çdo hap regjistrohet në audit."
            : "Flow: receive → notify → restrict → replace audio → remove audio → remove content. No automatic legal determinations — every step is audited."}
        </p>
        {claims.length === 0 && <p className="faint" style={{ fontSize: 13 }}>—</p>}
        {claims.map((cl) => (
          <div key={cl.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill status={cl.status === "resolved" || cl.status === "rejected" ? "pass" : "warning"} label={tx(CLAIM_FLOW_STEPS[cl.status] ?? { en: cl.status, sq: cl.status }, lang)} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>🎵 {cl.audioId}</div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {cl.claimantName} · {cl.source.replace(/_/g, " ")} · {new Date(cl.createdAt).toLocaleString()}
                  {cl.postId && ` · post ${cl.postId.slice(-6)}`}
                  {cl.fingerprintRef && ` · fp:${cl.fingerprintRef.slice(0, 12)}`}
                </div>
                <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.6 }}>{cl.assertion}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {cl.status === "notified" && (
                <button className="btn btn-sm" onClick={() => void runMutation(() => advance({ sessionToken: sessionToken!, claimId: cl.id, to: "restricted" }))}>
                  🚧 {lang === "sq" ? "Kufizo" : "Restrict"}
                </button>
              )}
              {cl.status === "restricted" && (
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const replacement = window.prompt(lang === "sq" ? "audioId zëvendësues (DENSEN-approved):" : "Replacement audioId (DENSEN-approved):", "a2");
                    if (replacement) void runMutation(() => advance({ sessionToken: sessionToken!, claimId: cl.id, to: "audio_replaced", replacementAudioId: replacement }));
                  }}
                >
                  🔁 {lang === "sq" ? "Zëvendëso audio" : "Replace audio"}
                </button>
              )}
              {(cl.status === "restricted" || cl.status === "audio_replaced") && (
                <button className="btn btn-sm" onClick={() => void runMutation(() => advance({ sessionToken: sessionToken!, claimId: cl.id, to: "audio_removed" }))}>
                  🔇 {lang === "sq" ? "Heq audio" : "Remove audio"}
                </button>
              )}
              {(cl.status === "restricted" || cl.status === "audio_replaced" || cl.status === "audio_removed") && (
                <button className="btn btn-sm" onClick={() => void runMutation(() => advance({ sessionToken: sessionToken!, claimId: cl.id, to: "content_removed" }))}>
                  🗑 {lang === "sq" ? "Heq përmbajtjen" : "Remove content"}
                </button>
              )}
              {cl.status !== "resolved" && cl.status !== "rejected" && (
                <button className="btn btn-sm" onClick={() => void runMutation(() => advance({ sessionToken: sessionToken!, claimId: cl.id, to: "under_review" }))}>
                  🔍 {lang === "sq" ? "Shqyrto" : "Review"}
                </button>
              )}
              {cl.status === "under_review" && (
                <>
                  <button className="btn btn-sm btn-primary" onClick={() => void runMutation(() => advance({ sessionToken: sessionToken!, claimId: cl.id, to: "resolved" }))}>
                    ✓ {lang === "sq" ? "Zgjidh" : "Resolve"}
                  </button>
                  <button className="btn btn-sm" onClick={() => void runMutation(() => advance({ sessionToken: sessionToken!, claimId: cl.id, to: "rejected" }))}>
                    ✕ {lang === "sq" ? "Refuzo" : "Reject"}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* disputes with evidence refs + review transitions */}
      <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>⚖️ {lang === "sq" ? "Kundërshtimet" : "Disputes"} ({disputes.length})</h2>
        {disputes.length === 0 && <p className="faint" style={{ fontSize: 13 }}>—</p>}
        {disputes.map((d) => (
          <div key={d.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill status={d.status === "accepted" || d.status === "resolved" ? "pass" : d.status === "rejected" ? "action_required" : "warning"} label={tx(DISPUTE_STATUS_LABELS[d.status] ?? { en: d.status, sq: d.status }, lang)} />
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{tx(DISPUTE_REASON_LABELS[d.reason] ?? { en: d.reason, sq: d.reason }, lang)}</div>
                <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{new Date(d.createdAt).toLocaleString()} · {lang === "sq" ? "kund" : "vs claim"} {d.claimId.slice(-6)}</div>
                <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.6 }}>{d.statement}</div>
                {d.evidenceRefs.length > 0 && (
                  <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
                    📎 {lang === "sq" ? "Dëshmi" : "Evidence"}: {d.evidenceRefs.join(", ")}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {d.status === "submitted" && (
                <button className="btn btn-sm" onClick={() => void runMutation(() => review({ sessionToken: sessionToken!, disputeId: d.id, to: "under_review" }))}>
                  🔍 {lang === "sq" ? "Shqyrto" : "Review"}
                </button>
              )}
              {(d.status === "under_review" || d.status === "submitted") && (
                <button className="btn btn-sm" onClick={() => void runMutation(() => review({ sessionToken: sessionToken!, disputeId: d.id, to: "more_information" }))}>
                  ℹ️ {lang === "sq" ? "Kërko informacion" : "More info"}
                </button>
              )}
              {(d.status === "under_review" || d.status === "more_information") && (
                <>
                  <button className="btn btn-sm btn-primary" onClick={() => void runMutation(() => review({ sessionToken: sessionToken!, disputeId: d.id, to: "accepted" }))}>
                    ✓ {lang === "sq" ? "Prano" : "Accept"}
                  </button>
                  <button className="btn btn-sm" onClick={() => void runMutation(() => review({ sessionToken: sessionToken!, disputeId: d.id, to: "rejected" }))}>
                    ✕ {lang === "sq" ? "Refuzo" : "Reject"}
                  </button>
                </>
              )}
              {(d.status === "accepted" || d.status === "rejected") && (
                <button className="btn btn-sm" onClick={() => void runMutation(() => review({ sessionToken: sessionToken!, disputeId: d.id, to: "resolved" }))}>
                  🏁 {lang === "sq" ? "Mbyll" : "Close"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* full music-records registry — the staff-maintained licensing source of truth */}
      <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>🎼 {lang === "sq" ? "Regjistri i muzikës" : "Music records registry"} ({(dash?.ok ? dash.records.length : 0)})</h2>
        <p className="faint" style={{ fontSize: 12, margin: "0 0 10px", lineHeight: 1.6 }}>
          {lang === "sq"
            ? "Burimi i vërtetë i licencave. Përdor përditësimin për të korrigjuar statusin, territoret, përdorimin e lejuar ose kufijtë e kohës — çdo ndryshim regjistrohet në audit."
            : "The licensing source of truth. Use edit to correct status, territories, permitted use or duration caps — every change is audited."}
        </p>
        {(dash?.ok ? dash.records : []).length === 0 && <p className="faint" style={{ fontSize: 13 }}>—</p>}
        {(dash?.ok ? dash.records : []).map((r) => (
          <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <strong>🎵 {r.title} — {r.artist}</strong>
              <StatusPill
                status={r.licensingStatus === "densen_licensed" || r.licensingStatus === "platform_licensed" ? "pass" : r.licensingStatus === "user_owned" || r.licensingStatus === "user_licensed" ? "neutral" : "action_required"}
                label={statusLabelAdmin(r.licensingStatus, lang)}
              />
              <span className="chip" style={{ fontSize: 10.5 }}>{r.audioId}</span>
            </div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
              {lang === "sq" ? "Të drejtat" : "Rights"}: {r.rightsHolder} · {lang === "sq" ? "Territore" : "Territories"}: {r.territories.length ? r.territories.join(", ") : (lang === "sq" ? "Botërore" : "Worldwide")} · {lang === "sq" ? "Përdorimi" : "Use"}: {r.permittedUse.join(", ") || "—"}
              {r.maxDurationSec !== undefined && ` · ${lang === "sq" ? "maks" : "max"} ${r.maxDurationSec}s`}
              {r.licenseExpiresAt !== undefined && ` · ${lang === "sq" ? "skadon" : "expires"} ${new Date(r.licenseExpiresAt).toLocaleDateString()}`}
            </div>
            {r.restrictions && <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>⚠ {r.restrictions}</div>}
          </div>
        ))}
      </div>

      {/* flagged music records with their real licensing facts */}
      <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>🚫 {lang === "sq" ? "Këngë të shënuara" : "Flagged music records"} ({flaggedRecords.length})</h2>
        {flaggedRecords.length === 0 && <p className="faint" style={{ fontSize: 13 }}>—</p>}
        {flaggedRecords.map((r) => (
          <div key={r.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <strong>🎵 {r.title} — {r.artist}</strong>
              <StatusPill status="action_required" label={statusLabelAdmin(r.licensingStatus, lang)} />
            </div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>
              {lang === "sq" ? "Të drejtat" : "Rights"}: {r.rightsHolder} · {lang === "sq" ? "Territore" : "Territories"}: {r.territories.length ? r.territories.join(", ") : "—"}
              {r.maxDurationSec !== undefined && ` · ${lang === "sq" ? "maks" : "max"} ${r.maxDurationSec}s`}
              {r.licenseExpiresAt !== undefined && ` · ${lang === "sq" ? "skadon" : "expires"} ${new Date(r.licenseExpiresAt).toLocaleDateString()}`}
              {r.fingerprintRef && ` · fp:${r.fingerprintRef.slice(0, 12)}`}
            </div>
            {r.restrictions && <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>⚠ {r.restrictions}</div>}
          </div>
        ))}
      </div>

      {/* append-only audit trail for every rights action */}
      <div className="panel" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 15, marginBottom: 10 }}>🧾 {lang === "sq" ? "Audit i të drejtave" : "Rights audit trail"}</h2>
        {(!audit || !audit.ok || audit.entries.length === 0) && <p className="faint" style={{ fontSize: 13 }}>—</p>}
        {audit?.ok &&
          audit.entries.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5, flexWrap: "wrap" }}>
              <span className="chip" style={{ fontSize: 10.5 }}>{e.eventType}</span>
              <span style={{ flex: 1, minWidth: 160 }}>{e.summary}</span>
              <span className="faint" style={{ fontSize: 11.5 }}>{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
      </div>
    </>
  );
}

function statusLabelAdmin(s: string, lang: "en" | "sq"): string {
  return tx(MUSIC_STATUS_LABELS[s] ?? { en: s.toUpperCase(), sq: s.toUpperCase() }, lang);
}

/** Tiny wrapper so the dashboard stays readable: run a mutation, swallow rejections (toasts surface errors). */
function runMutation(fn: () => Promise<unknown>): void {
  void fn().catch(() => {
    // Errors are surfaced by Convex toasts already; keep the dashboard alive.
  });
}

/* ==================== 64: CHILD SAFETY & TRUST DASHBOARD ==================== */
function TrustDashboard() {
  const { t, lang } = useStore();
  const gov = useGov();
  const role = gov.staffRole;

  const contactFlags = gov.auditEvents.filter((e) => e.type === "contact_flag");
  const csReports = gov.reports.filter((r) => r.category === "child_safety");
  const groomingQueue = contactFlags; // pattern events feed the grooming review queue
  const appeals: typeof gov.auditEvents = gov.auditEvents.filter((e) => e.type === "appeal");
  const restrictions: typeof gov.auditEvents = gov.auditEvents.filter((e) => e.type === "account_restriction");
  const visibleEvents = gov.auditEvents.filter((e) => canViewEvent(role, e.type));
  const hiddenCount = gov.auditEvents.length - visibleEvents.length;

  const Queue = ({ icon, title, rows, empty }: { icon: string; title: string; rows: { id: string; main: string; sub?: string }[]; empty: string }) => (
    <div className="panel" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 10 }}>{icon} {title} ({rows.length})</h3>
      {rows.length === 0 ? (
        <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>{empty}</p>
      ) : (
        rows.map((r) => (
          <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
            <div style={{ fontWeight: 700 }}>{r.main}</div>
            {r.sub && <div className="faint" style={{ marginTop: 2 }}>{r.sub}</div>}
          </div>
        ))
      )}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="panel" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <StatusPill status="neutral" label={`${t("gov.admin.roleSelect")}: ${tx(STAFF_ROLE_LABELS[role], lang)}`} />
        <span className="faint" style={{ fontSize: 12 }}>
          {t("gov.required")}: {ROLE_PERMS[role].queues.join(", ")} · private reports: {String(ROLE_PERMS[role].privateReports)}
        </span>
        {hiddenCount > 0 && (
          <StatusPill status="warning" label={`${hiddenCount} ${t("gov.admin.restrictedHidden")}`} />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <Queue
          icon="🚨"
          title={t("gov.report.childNote")}
          rows={csReports.map((r) => ({ id: r.id, main: `${r.targetType} · ${r.targetId}`, sub: `${r.details || r.category} · ${new Date(r.ts).toLocaleString()} · ${r.status}` }))}
          empty={t("gov.admin.noOpenReports")}
        />
        <Queue
          icon="🧭"
          title={t("gov.admin.contactFlags")}
          rows={groomingQueue.map((e) => ({ id: e.id, main: e.summary, sub: `${e.subject ?? ""} · ${new Date(e.ts).toLocaleString()}` }))}
          empty={t("gov.admin.noOpenReports")}
        />
        <Queue
          icon="🚧"
          title={t("gov.admin.restrictions")}
          rows={restrictions.map((e) => ({ id: e.id, main: e.summary, sub: new Date(e.ts).toLocaleString() }))}
          empty={t("gov.admin.noOpenReports")}
        />
        <Queue
          icon="📣"
          title={t("gov.admin.appeals")}
          rows={appeals.map((e) => ({ id: e.id, main: e.summary, sub: new Date(e.ts).toLocaleString() }))}
          empty={t("gov.admin.noOpenReports")}
        />
      </div>

      {/* 56: verification queue */}
      <div className="panel" style={{ padding: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>🎓 {t("gov.admin.verificationQueue")} ({TEACHER_VERIFICATIONS.filter((v) => v.status === "pending").length} pending)</h3>
        {users.filter((u) => u.teacher).map((u) => {
          const v = TEACHER_VERIFICATIONS.find((x) => x.userId === u.id);
          const verified = isVerifiedTeacher(u.id);
          return (
            <div key={u.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
              <img src={u.avatar} alt={`Profile photo of ${u.name}, dance teacher`} style={{ width: 32, height: 32, borderRadius: "50%" }} />
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div>
                <div className="faint" style={{ fontSize: 11.5 }}>@{u.username} · {v ? tx(v.checked, lang) : "—"}</div>
              </div>
              <StatusPill status={verified ? "pass" : "warning"} label={verified ? t("gov.profile.verifiedTeacher") : t("gov.profile.verificationPending")} />
            </div>
          );
        })}
        <p className="faint" style={{ fontSize: 11.5, margin: "10px 0 0" }}>
          {TEACHER_VERIFICATIONS[0]?.docsNote[lang]}
        </p>
      </div>

      {/* 63: audit log with role filtering */}
      <div className="panel" style={{ padding: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>🧾 {t("gov.admin.auditLog")} ({visibleEvents.length})</h3>
        {visibleEvents.length === 0 ? (
          <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>—</p>
        ) : (
          visibleEvents.slice(0, 12).map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5, flexWrap: "wrap" }}>
              <StatusPill status={e.severity === "critical" ? "action_required" : e.severity === "high" ? "warning" : "neutral"} label={tx(AUDIT_LABELS[e.type], lang)} />
              <span style={{ flex: 1, minWidth: 160 }}>{e.summary}{e.subject ? ` · ${e.subject}` : ""}</span>
              <span className="faint" style={{ fontSize: 11.5 }}>{new Date(e.ts).toLocaleString()}</span>
            </div>
          ))
        )}
      </div>

      {/* 65: security posture */}
      <div className="panel" style={{ padding: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>🔐 {t("gov.admin.securityPosture")}</h3>
        {SECURITY_CONTROLS.map((s) => (
          <div key={s.id} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5, flexWrap: "wrap" }}>
            <StatusPill status={s.status === "enforced" ? "pass" : "warning"} label={s.status === "enforced" ? t("gov.admin.enforced") : t("gov.admin.planned")} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <strong>{tx(s.label, lang)}</strong>
              <div className="faint" style={{ marginTop: 2, lineHeight: 1.6 }}>{tx(s.detail, lang)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* live contact-pattern monitor */}
      <div className="panel" style={{ padding: 16 }}>
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>📡 {t("gov.admin.moderationHistory")}</h3>
        {users.filter((u) => u.minor).map((u) => {
          const n = gov.contactAttempts.filter((a) => a.to === u.id).length;
          const level = evaluateContactPattern(n, true);
          return (
            <div key={u.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 12.5 }}>
              <img src={u.avatar} alt={`Profile photo of ${u.name}, teenage dancer`} style={{ width: 30, height: 30, borderRadius: "50%" }} />
              <span style={{ flex: 1 }}>@{u.username} — {n} contact attempt(s)</span>
              <StatusPill status={level === "restrict" ? "action_required" : level === "watch" ? "warning" : "pass"} label={level} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
