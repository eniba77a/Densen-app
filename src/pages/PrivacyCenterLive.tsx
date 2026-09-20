/**
 * DENSEN — Privacy Center (live, server-backed).
 * ==============================================
 * Rendered only for signed-in users (the guest experience keeps the existing
 * `/privacy` hub). Every toggle is a preview: the SERVER re-decides each change
 * through `convex/privacyInternals.ts` — minors can never loosen a protection
 * and the effective values shown come from the server response.
 *
 * Sections: Account Privacy, Messaging Privacy, Comments, Mentions, Tags,
 * Remix, Duet, Downloads, Location, Notifications, Personalization, Blocked
 * Accounts, Data, Permissions, Consents, Delete Account.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "../components/ui";
import { useStore } from "../state/store";
import { useGov } from "../state/governance";
import { useAuth } from "../state/auth";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Toggle } from "./Settings";
import { detectRegion } from "../data/governance";

type Snapshot = {
  ok: true;
  viewer: { band: string; ageCategory: "child" | "teen" | "adult"; isMinor: boolean; role: string };
  privacy: {
    privateAccount: boolean;
    messagesFrom: string;
    commentFilter: boolean;
    discoverableByHandle: boolean;
    showCity: boolean;
    personalization: boolean;
    mentionsFrom: string;
    tagsFrom: string;
    notificationsEnabled: boolean;
  };
  reuse: { allowRemix: boolean; allowDuet: boolean; allowDownloads: boolean; city?: string };
  consents: {
    current: Record<string, { granted: boolean; version: string }>;
    history: { type: string; granted: boolean; version: string; region: string; source: string; createdAt: number }[];
  };
  devicePermissions: Record<string, string>;
  blocked: { userId: string; handle: string; displayName: string }[];
};

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 22, scrollMarginTop: 80 }}>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        {sub && <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

const AUDIENCES = ["everyone", "followers", "none"] as const;

export default function PrivacyCenterLive() {
  const { t, toast } = useStore();
  const gov = useGov();
  const auth = useAuth();
  const nav = useNavigate();
  const token = auth.sessionToken!;

  const snap = useQuery(api.privacy.getPrivacyCenter, { sessionToken: token }) as Snapshot | { ok: false; error: string } | undefined;
  const updatePrivacy = useMutation(api.privacy.updatePrivacySettings);
  const recordConsent = useMutation(api.privacy.recordConsent);
  const setPermission = useMutation(api.privacy.setDevicePermission);
  const unblock = useMutation(api.privacy.unblockUser);
  const requestDeletion = useMutation(api.privacy.requestAccountDeletion);
  const updateProfile = useMutation(api.profiles.updateProfile);

  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (snap === undefined) {
    return (
      <Page>
        <span className="eyebrow">{t("privacy.live.title")}</span>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 16px" }}>{t("privacy.live.title")}</h1>
        <p className="faint" style={{ fontSize: 13 }}>{t("privacy.live.loading")}</p>
      </Page>
    );
  }
  if (!snap || !snap.ok) {
    return (
      <Page>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: "6px 0 16px" }}>{t("privacy.live.title")}</h1>
        <p className="faint" style={{ fontSize: 13 }}>{t("privacy.live.offline")}</p>
      </Page>
    );
  }

  const s = snap.privacy;
  const minor = snap.viewer.isMinor;
  const locked = (label: string) => `🔒 ${label}`.trim();

  const patch = async (p: Record<string, unknown>) => {
    try {
      await updatePrivacy({ sessionToken: token, patch: p as never });
      toast(t("privacy.live.saved"));
    } catch {
      toast(t("privacy.live.error"));
    }
  };
  const reuse = async (key: "allowRemix" | "allowDuet" | "allowDownloads", value: boolean) => {
    try {
      await updateProfile({ sessionToken: token, patch: { [key]: value } as never });
      toast(t("privacy.live.saved"));
    } catch {
      toast(t("privacy.live.error"));
    }
  };
  const consent = async (type: string, granted: boolean) => {
    try {
      await recordConsent({ sessionToken: token, type, granted, source: "privacy_center", region: detectRegion() });
      if (!granted) toast(t("privacy.live.withdrawn"));
      else toast(t("privacy.live.saved"));
    } catch {
      toast(t("privacy.live.error"));
    }
  };
  const requestPermission = async (key: string) => {
    // Real OS prompt only — on explicit feature activation, never at signup.
    const result = await gov.requestPermission(key as never);
    try {
      await setPermission({ sessionToken: token, permission: key, state: result });
    } catch {
      /* server record is best-effort; the OS state is authoritative */
    }
  };
  const doDelete = async () => {
    if (deleteText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      await requestDeletion({ sessionToken: token, confirmText: deleteText });
      await auth.signOut();
      nav("/");
    } catch {
      toast(t("privacy.live.error"));
    } finally {
      setDeleting(false);
    }
  };

  const ageChip =
    snap.viewer.ageCategory === "child" ? t("privacy.live.age.child")
    : snap.viewer.ageCategory === "teen" ? t("privacy.live.age.teen")
    : t("privacy.live.age.adult");

  return (
    <Page>
      <span className="eyebrow">{t("privacy.live.title")}</span>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 4px" }}>🛡️ {t("privacy.live.title")}</h1>
      <p className="muted" style={{ fontSize: 14, margin: "0 0 14px" }}>{t("privacy.live.sub")}</p>

      <div className="panel" style={{ padding: 14, marginBottom: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderColor: "var(--gold-line)" }}>
        <span className="chip">{t("privacy.live.agecat")}: <strong>{ageChip}</strong></span>
        <span className="faint" style={{ fontSize: 12 }}>{t("privacy.live.dobNote")}</span>
      </div>

      {minor && (
        <div className="panel" style={{ padding: 14, marginBottom: 18, background: "linear-gradient(120deg, rgba(227,179,65,0.08), transparent 60%), var(--panel)" }}>
          <strong style={{ fontSize: 14 }}>🛡️ {t("privacy.live.youthTitle")}</strong>
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, margin: "6px 0 0" }}>{t("privacy.live.youthSub")}</p>
        </div>
      )}

      {/* Account Privacy · Messaging Privacy · Comments · Mentions · Tags */}
      <Section id="account-privacy" title={`🔒 ${t("privacy.live.accountPrivacy")}`}>
        <div className="panel" style={{ padding: "4px 16px" }}>
          <Row label={t("settings.privateAccount")} sub={t("settings.privateAccountSub")}>
            <Toggle on={s.privateAccount} label={t("settings.privateAccount")} onChange={(v) => patch({ privateAccount: v })} />
          </Row>
          <Row label={t("privacy.live.messagingPrivacy")} sub={minor ? locked(t("privacy.live.locked")) : undefined}>
            <select
              className="input"
              style={{ width: 150 }}
              value={s.messagesFrom}
              aria-label={t("privacy.live.messagingPrivacy")}
              disabled={minor}
              onChange={(e) => patch({ messagesFrom: e.target.value })}
            >
              {AUDIENCES.map((a) => <option key={a} value={a}>{t(`settings.${a === "everyone" ? "everyone" : a === "followers" ? "followersOnly" : "noOne"}`)}</option>)}
            </select>
          </Row>
          <Row label={t("settings.comments")} sub={t("settings.commentsSub")}>
            <Toggle on={s.commentFilter} label={t("settings.comments")} onChange={(v) => patch({ commentFilter: v })} />
          </Row>
          <Row label={t("privacy.live.mentions")} sub={minor ? locked(t("privacy.live.locked")) : undefined}>
            <select className="input" style={{ width: 150 }} value={s.mentionsFrom} aria-label={t("privacy.live.mentions")} disabled={minor}
              onChange={(e) => patch({ mentionsFrom: e.target.value })}>
              {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Row>
          <Row label={t("privacy.live.tags")} sub={minor ? locked(t("privacy.live.locked")) : undefined}>
            <select className="input" style={{ width: 150 }} value={s.tagsFrom} aria-label={t("privacy.live.tags")} disabled={minor}
              onChange={(e) => patch({ tagsFrom: e.target.value })}>
              {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Row>
        </div>
      </Section>

      {/* Remix · Duet · Downloads (creator reuse — server-clamped for minors) */}
      <Section id="reuse" title={`💃 ${t("privacy.live.reuse")}`}>
        <div className="panel" style={{ padding: "4px 16px" }}>
          <Row label={t("settings.allowDuet")} sub={t("privacy.live.reuseSub")}>
            <Toggle on={snap.reuse.allowDuet} label={t("settings.allowDuet")} onChange={(v) => reuse("allowDuet", v)} />
          </Row>
          <Row label={t("privacy.live.remix")}>
            <Toggle on={snap.reuse.allowRemix} label={t("privacy.live.remix")} onChange={(v) => reuse("allowRemix", v)} />
          </Row>
          <Row label={t("privacy.live.downloads")}>
            <Toggle on={snap.reuse.allowDownloads} label={t("privacy.live.downloads")} onChange={(v) => reuse("allowDownloads", v)} />
          </Row>
        </div>
      </Section>

      {/* Location — approximate city only, adults; never precise, never GPS */}
      <Section id="location" title={`📍 ${t("privacy.live.location")}`}>
        <div className="panel" style={{ padding: "4px 16px" }}>
          <Row label={t("settings.showLocation")} sub={minor ? locked(t("privacy.live.locked")) : t("settings.privateAccountSub")}>
            <Toggle on={s.showCity} label={t("settings.showLocation")} onChange={(v) => patch({ showCity: v })} />
          </Row>
          <Row label={t("privacy.live.locationPrecise")}>
            <span className="status pass">✓ {t("privacy.live.locationNever")}</span>
          </Row>
        </div>
      </Section>

      {/* Notifications (OS + in-app) */}
      <Section id="notifications" title={`🔔 ${t("privacy.live.notifications")}`}>
        <div className="panel" style={{ padding: "4px 16px" }}>
          <Row label={t("privacy.live.notifInApp")}>
            <Toggle on={s.notificationsEnabled} label={t("privacy.live.notifInApp")} onChange={(v) => patch({ notificationsEnabled: v })} />
          </Row>
          <Row label={t("privacy.live.notifOs")} sub={t("privacy.live.notifOsSub")}>
            <button className="chip" onClick={() => requestPermission("notifications")}>{t("privacy.live.request")}</button>
          </Row>
        </div>
      </Section>

      {/* Personalization — optional, consent-tracked, never for minors */}
      <Section id="personalization" title={`✨ ${t("privacy.live.personalization")}`}>
        <div className="panel" style={{ padding: "4px 16px" }}>
          <Row label={t("privacy.live.personalizationOn")} sub={minor ? locked(t("privacy.live.locked")) : t("privacy.live.personalizationSub")}>
            <Toggle on={s.personalization} label={t("privacy.live.personalizationOn")} disabled={minor} onChange={(v) => { patch({ personalization: v }); void consent("personalization", v); }} />
          </Row>
        </div>
      </Section>

      {/* Blocked Accounts */}
      <Section id="blocked" title={`🚫 ${t("privacy.live.blocked")}`}>
        <div className="panel" style={{ padding: "8px 16px" }}>
          {snap.blocked.length === 0 && <p className="faint" style={{ padding: "10px 0" }}>{t("gov.blockedEmpty")}</p>}
          {snap.blocked.map((b) => (
            <Row key={b.userId} label={b.displayName} sub={`@${b.handle}`}>
              <button className="btn btn-sm" onClick={() => { void unblock({ sessionToken: token, targetUserId: b.userId }); toast(t("privacy.live.unblocked")); }}>
                {t("gov.unblock")}
              </button>
            </Row>
          ))}
        </div>
      </Section>

      {/* Data — export the server-backed snapshot (own data, no DOB inside) */}
      <Section id="data" title={`📦 ${t("privacy.live.data")}`}>
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{t("privacy.live.dataSub")}</p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `densen-privacy-export-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            ⬇ {t("gov.export.btn")}
          </button>
        </div>
      </Section>

      {/* Permissions — real OS prompts, requested only on feature activation */}
      <Section id="permissions" title={`🔐 ${t("privacy.live.permissions")}`}>
        <p className="faint" style={{ fontSize: 12.5, margin: "-6px 0 10px" }}>{t("privacy.live.permsSub")}</p>
        <div className="panel" style={{ padding: "4px 16px" }}>
          {(["camera", "microphone", "photos", "location", "notifications"] as const).map((p) => {
            const st = snap.devicePermissions[p] ?? "unknown";
            return (
              <Row key={p} label={t(`privacy.live.perm.${p}`)} sub={st === "granted" ? t("gov.perms.granted") : st === "denied" ? t("gov.perms.denied") : t("privacy.live.permUnknown")}>
                <button className="chip" onClick={() => requestPermission(p)}>{t("privacy.live.request")}</button>
              </Row>
            );
          })}
        </div>
      </Section>

      {/* Consents — per-document records with versions; optional ones start unchecked */}
      <Section id="consents" title={`🧾 ${t("privacy.live.consents")}`}>
        <p className="faint" style={{ fontSize: 12.5, margin: "-6px 0 10px" }}>{t("privacy.live.consentsSub")}</p>
        <div className="panel" style={{ padding: "4px 16px" }}>
          {(["terms", "privacy", "guidelines"] as const).map((k) => (
            <Row key={k} label={t(`privacy.live.consent.${k}`)} sub={`${t("gov.version")} ${snap.consents.current[k]?.version ?? "—"}`}>
              <span className="status pass">✓ {t("gov.consents.granted")}</span>
            </Row>
          ))}
          <Row label={t("privacy.live.consent.marketing_email")} sub={minor ? locked(t("privacy.live.locked")) : t("privacy.live.consentMarketingSub")}>
            <Toggle on={snap.consents.current["marketing_email"]?.granted ?? false} disabled={minor} label={t("privacy.live.consent.marketing_email")} onChange={(v) => consent("marketing_email", v)} />
          </Row>
          <Row label={t("privacy.live.consent.personalization")} sub={minor ? locked(t("privacy.live.locked")) : t("privacy.live.personalizationSub")}>
            <Toggle on={snap.consents.current["personalization"]?.granted ?? false} disabled={minor} label={t("privacy.live.consent.personalization")} onChange={(v) => consent("personalization", v)} />
          </Row>
          <Row label={t("privacy.live.consent.music_rights")} sub={minor ? locked(t("privacy.live.locked")) : t("privacy.live.consentMusicSub")}>
            <Toggle on={snap.consents.current["music_rights"]?.granted ?? false} disabled={minor} label={t("privacy.live.consent.music_rights")} onChange={(v) => consent("music_rights", v)} />
          </Row>
        </div>
        {snap.consents.history.length > 0 && (
          <div className="panel" style={{ padding: "8px 16px", marginTop: 10 }}>
            {snap.consents.history.slice(0, 12).map((h, i) => (
              <Row
                key={i}
                label={t(`privacy.live.consent.${h.type}` as never)}
                sub={`${new Date(h.createdAt).toLocaleString()} · ${t("gov.version")} ${h.version} · ${h.source}`}
              >
                <span className={`status ${h.granted ? "pass" : "warning"}`}>{h.granted ? `✓ ${t("gov.consents.granted")}` : `↩ ${t("gov.consents.withdrawn")}`}</span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      {/* Delete Account — typed confirmation, real server-side erasure request */}
      <Section id="delete" title={`🗑️ ${t("privacy.live.delete")}`}>
        <div className="panel" style={{ padding: 18, borderColor: "rgba(248,113,113,0.35)" }}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{t("privacy.live.deleteSub")}</p>
          <label className="input-label" htmlFor="del-live-confirm">{t("gov.del.confirmLabel")}</label>
          <input id="del-live-confirm" className="input" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" autoComplete="off" />
          <button className="btn btn-danger" style={{ width: "100%", marginTop: 12 }} disabled={deleting || deleteText.trim().toUpperCase() !== "DELETE"} onClick={() => void doDelete()}>
            🗑️ {t("privacy.live.deleteBtn")}
          </button>
        </div>
      </Section>
    </Page>
  );
}
