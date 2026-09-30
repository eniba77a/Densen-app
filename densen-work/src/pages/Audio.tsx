import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Page, SectionHeader } from "../components/ui";
import { IcMusic } from "../components/icons";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { audios, fmt, posts } from "../data/store";
import {
  CLAIM_FLOW_LABELS,
  DISPUTE_REASONS,
  DISPUTE_STATUS_LABELS,
  uploadEvidence,
  type MyClaimRow,
} from "../lib/musicRightsClient";

export default function Audio() {
  const { t, lang, toast } = useStore();
  const auth = useAuth();
  const convex = useConvex();
  const nav = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <Page>
      <MusicRightsSection
        toast={toast}
        auth={auth}
        convex={convex}
        lang={lang}
        t={t}
        selected={selected}
        setSelected={setSelected}
        nav={nav}
      />
    </Page>
  );
}

/* ==================== Day 13: live music + rights page ==================== */

function MusicRightsSection({
  toast,
  auth,
  convex,
  lang,
  t,
  selected,
  setSelected,
  nav,
}: {
  toast: (m: string) => void;
  auth: ReturnType<typeof useAuth>;
  convex: ReturnType<typeof useConvex>;
  lang: "en" | "sq";
  t: (k: never) => string;
  selected: string | null;
  setSelected: (v: string | null) => void;
  nav: (to: string) => void;
}) {
  const [tab, setTab] = useState<"catalog" | "rights">("catalog");

  return (
    <>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{t("audio.title" as never)}</h1>
      <p className="muted" style={{ margin: "0 0 18px", fontSize: 14 }}>
        {lang === "sq"
          ? "Audio me licenca reale — secila këngë tregon statusin e saj të vërtetë të të drejtave."
          : "Licensed audio — every track shows its real rights status."}
      </p>

      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
        {([
          { id: "catalog", label: lang === "sq" ? "🎵 Audio në trend" : "🎵 Trending audio" },
          { id: "rights", label: lang === "sq" ? "©️ Të drejtat e mia" : "©️ My rights" },
        ] as const).map((o) => (
          <button key={o.id} className={`chip${tab === o.id ? " active" : ""}`} onClick={() => setTab(o.id)}>
            {o.label}
          </button>
        ))}
      </div>

      {tab === "catalog" ? (
        <TrendingAudio lang={lang} t={t} selected={selected} setSelected={setSelected} toast={toast} nav={nav} />
      ) : (
        <MyRights lang={lang} toast={toast} auth={auth} convex={convex} />
      )}
    </>
  );
}

/* ---------------- trending audio (demo registry, unchanged behavior) ---------------- */

function TrendingAudio({
  lang,
  t,
  selected,
  setSelected,
  toast,
  nav,
}: {
  lang: "en" | "sq";
  t: (k: never) => string;
  selected: string | null;
  setSelected: (v: string | null) => void;
  toast: (m: string) => void;
  nav: (to: string) => void;
}) {
  void lang;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 30 }}>
      {audios.map((a) => {
        const using = posts.filter((p) => p.audioId === a.id);
        const open = selected === a.id;
        return (
          <div key={a.id} className="panel" style={{ overflow: "hidden" }}>
            <button
              onClick={() => setSelected(open ? null : a.id)}
              style={{ display: "flex", gap: 14, padding: 14, alignItems: "center", width: "100%", background: "none", border: "none", cursor: "pointer", color: "inherit", textAlign: "left" }}
            >
              <div style={{ position: "relative", width: 64, height: 64, borderRadius: 14, overflow: "hidden", flexShrink: 0 }}>
                <img src={a.cover} alt="" className="media-cover" />
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}>
                  <IcMusic size={20} />
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{a.name}</div>
                <div className="muted" style={{ fontSize: 13 }}>{a.artist} · {a.dur}</div>
                <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>
                  {fmt(a.uses)} {t("audio.videos" as never)}
                </div>
              </div>
              <span className={`btn btn-sm ${open ? "" : "btn-primary"}`}>{open ? "▲" : t("audio.use" as never)}</span>
            </button>
            {open && (
              <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--line)" }}>
                <SectionHeader title={t("audio.trendingWith" as never)} />
                <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto" }}>
                  {using.map((p) => (
                    <div
                      key={p.id}
                      style={{ flex: "0 0 108px", position: "relative", aspectRatio: "9/16", borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)", background: "var(--panel-2)" }}
                    >
                      <img src={p.cover} alt="" className="media-cover" />
                    </div>
                  ))}
                  {using.length === 0 && <p className="faint" style={{ fontSize: 13 }}>—</p>}
                </div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 14, width: "100%" }} onClick={() => { toast(t("audio.use" as never) + " — " + a.name); nav("/create"); }}>
                  🎵 {t("audio.use" as never)}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- my rights: claims against my posts + dispute flow ---------------- */

function MyRights({
  lang,
  toast,
  auth,
  convex,
}: {
  lang: "en" | "sq";
  toast: (m: string) => void;
  auth: ReturnType<typeof useAuth>;
  convex: ReturnType<typeof useConvex>;
}) {
  const claims = useQuery(
    api.musicRightsWire.listMyClaims,
    auth.sessionToken ? ({ sessionToken: auth.sessionToken } as never) : "skip"
  ) as { ok: boolean; claims: MyClaimRow[] } | null | undefined;

  const submitDispute = useMutation(api.musicRightsWire.submitDispute);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [reason, setReason] = useState("i_own");
  const [statement, setStatement] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!auth.viewer || !auth.sessionToken) {
    return (
      <div className="panel" style={{ padding: 16 }}>
        <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
          {lang === "sq"
            ? "Hyr në llogari për të parë pretendimet e të drejtave të autorit ndaj postimeve të tua dhe për të kundërshtuar me dëshmi."
            : "Sign in to see copyright claims against your posts and to dispute them with evidence."}
        </p>
      </div>
    );
  }

  const rows = claims?.ok ? claims.claims : [];

  const doDispute = async (claimId: string) => {
    setBusy(true);
    try {
      const res = (await submitDispute({
        sessionToken: auth.sessionToken!,
        claimId,
        reason: reason as never,
        statement,
        evidenceRefs: evidence,
      })) as { ok: boolean };
      if (res.ok) {
        toast(lang === "sq" ? "Kundërshtimi u dërgua — radha për shqyrtimin e stafit." : "Dispute submitted — queued for staff review.");
        setOpenClaim(null);
        setStatement("");
        setEvidence([]);
      } else {
        toast(lang === "sq" ? "Kundërshtimi dështoi." : "Dispute failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const pickEvidence = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const id = await uploadEvidence(
        (ref, args) => convex.mutation(ref as never, args as never) as never,
        api.musicRightsWire.requestEvidenceUpload,
        file
      );
      if (id) {
        setEvidence((prev) => [...prev, id]);
        toast(lang === "sq" ? "Dëshmia u ngarkua." : "Evidence uploaded.");
      } else {
        toast(lang === "sq" ? "Ngarkimi i dëshmisë dështoi." : "Evidence upload failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="panel" style={{ padding: 16 }}>
        <strong style={{ fontSize: 14, display: "block", marginBottom: 6 }}>©️ {lang === "sq" ? "Pretendimet ndaj përmbajtjes sime" : "Claims against my content"}</strong>
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
          {lang === "sq"
            ? "Pretendimet jane kërkesa për shqyrtim — jo vendime ligjore. Mund t'i kundërshtosh një herë me arsyen dhe dëshminë tënde; stafi vendos."
            : "Claims are requests for review — not legal determinations. You can dispute once with your reason and evidence; staff decide."}
        </p>
      </div>

      {rows.length === 0 && (
        <div className="panel" style={{ padding: 16 }}>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            {claims === undefined
              ? "…"
              : lang === "sq"
                ? "Nuk ka pretendime. Përdor audio nga katalogu i licencuar për t'u mbetur në anën e sigurt."
                : "No claims. Use audio from the licensed catalog to stay on the safe side."}
          </p>
        </div>
      )}

      {rows.map((cl) => {
        const flow = CLAIM_FLOW_LABELS[cl.status] ?? { en: cl.status, sq: cl.status };
        const open = openClaim === cl.id;
        return (
          <div key={cl.id} className="panel" style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`status ${cl.status === "resolved" || cl.status === "rejected" ? "pass" : "action_required"}`} role="status">
                <span aria-hidden>©️</span> {flow[lang]}
              </span>
              {cl.dispute && (
                <span className="chip" style={{ fontSize: 10.5 }}>
                  {lang === "sq" ? "kundërshtim" : "dispute"}: {(DISPUTE_STATUS_LABELS[cl.dispute.status] ?? { en: cl.dispute.status, sq: cl.dispute.status })[lang]}
                </span>
              )}
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>🎵 {cl.audioId}</div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
              {new Date(cl.createdAt).toLocaleString()}
              {cl.postId && ` · ${lang === "sq" ? "postimi" : "post"} ${cl.postId.slice(-6)}`}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>{cl.assertion}</div>

            {cl.dispute?.reviewNote && (
              <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
                {lang === "sq" ? "Shënim i stafit" : "Staff note"}: {cl.dispute.reviewNote}
              </p>
            )}

            {!cl.dispute && cl.status !== "resolved" && cl.status !== "rejected" && (
              <>
                {!open ? (
                  <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => { setOpenClaim(cl.id); setReason("i_own"); }}>
                    ⚖️ {lang === "sq" ? "Kundërshto" : "Dispute"}
                  </button>
                ) : (
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    <div>
                      <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
                        {lang === "sq" ? "Arsyeja" : "Reason"}
                      </label>
                      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                        {DISPUTE_REASONS.map((r) => (
                          <button key={r.value} className={`chip${reason === r.value ? " active" : ""}`} onClick={() => setReason(r.value)}>
                            {r[lang]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
                        {lang === "sq" ? "Shpjegimi" : "Statement"}
                      </label>
                      <textarea
                        className="input"
                        rows={3}
                        maxLength={2000}
                        value={statement}
                        onChange={(e) => setStatement(e.target.value)}
                        placeholder={lang === "sq" ? "Përshkruaj pse pretendimi është i pasaktë…" : "Describe why the claim is incorrect…"}
                      />
                    </div>
                    <div>
                      <label className="eyebrow" style={{ display: "block", marginBottom: 6 }}>
                        {lang === "sq" ? "Dëshmi (licenca, dokument pronësie)" : "Evidence (license, ownership docs)"}
                      </label>
                      <input type="file" className="input" onChange={(e) => void pickEvidence(e.target.files?.[0])} disabled={busy} />
                      {evidence.length > 0 && (
                        <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>
                          📎 {evidence.length} {lang === "sq" ? "skedarë ngarkuar" : "file(s) uploaded"}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-primary btn-sm" disabled={busy || statement.trim().length === 0} onClick={() => void doDispute(cl.id)}>
                        {busy ? "…" : lang === "sq" ? "Dërgo kundërshtimin" : "Submit dispute"}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setOpenClaim(null)}>
                        {lang === "sq" ? "Anulo" : "Cancel"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
