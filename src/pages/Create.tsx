import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Empty, Page } from "../components/ui";
import { IcCheck, IcMusic } from "../components/icons";
import { useStore } from "../state/store";
import { useGov } from "../state/governance";
import { useAuth } from "../state/auth";
import { PermissionGate, tx } from "../components/gov-ui";
import { scanClaims } from "../data/governance";
import { reuseDefaultsFor, scanVideoSubmission, publishStatusLabel, canReuse } from "../data/safety";
import { audios, posts, userById, users } from "../data/store";
import { IMG, VID } from "../data/media";
import type { Post } from "../data/store";
import {
  precheckVideoFile,
  probeVideoDuration,
  uploadDanceVideo,
  type UploadErrorCode,
  type UploadStage,
} from "../lib/videoUpload";
type LString = { en: string; sq: string };

const UPLOAD_ACCEPT = "video/mp4,video/quicktime,video/webm";

/** Fallback for any server error code not in the map — never render undefined. */
const GENERIC_UPLOAD_ERROR: LString = { en: "Publish failed. Please try again.", sq: "Publikimi dështoi. Provo përsëri." };

const uploadStatusMeta = (s: UploadStage): { icon: string; labelKey: LString | null; pct: number | null } | null => {
  switch (s.stage) {
    case "preparing":
      return { icon: "⏳", labelKey: { en: "Preparing upload…", sq: "Përgatitja e ngarkimit…" }, pct: null };
    case "uploading":
      return { icon: "⬆️", labelKey: { en: "Uploading video…", sq: "Ngarkimi i videos…" }, pct: s.percent };
    case "processing":
      return { icon: "⚙️", labelKey: { en: "Processing…", sq: "Përpunimi…" }, pct: null };
    case "thumbnail":
      return { icon: "🖼️", labelKey: { en: "Capturing thumbnail…", sq: "Kapja e miniaturës…" }, pct: s.percent };
    case "done":
      return { icon: "✅", labelKey: { en: "Upload complete — ready to publish", sq: "Ngarkimi përfundoi — gati për publikim" }, pct: 100 };
    default:
      return null;
  }
};

const STYLES = ["Hip Hop", "Commercial", "Contemporary", "Jazz", "Latin", "Kids", "Beginners", "Advanced"];

/* ---------------- create post ---------------- */
export default function Create() {
  const { t, lang, allPosts, addPost, toast } = useStore();
  const gov = useGov();
  const auth = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const challengeId = params.get("challenge");
  // Day 7 — Remix/Duet lineage: /create?remix=<postId> or ?duet=<postId>
  // pre-fills the composer as a response to the original.
  const remixOf = params.get("remix");
  const duetOf = params.get("duet");
  const convex = useConvex();
  const createPostLive = useMutation(api.content.createPost);

  const [source, setSource] = useState<"upload" | "record" | "photo">("upload");
  const [caption, setCaption] = useState(challengeId ? "My entry for the weekly challenge 🔥" : "");
  const [hashtags, setHashtags] = useState<string[]>(challengeId ? ["#densenchallenge"] : ["#densen"]);
  const [tagInput, setTagInput] = useState("");
  const [style, setStyle] = useState("Hip Hop");
  const [tagged, setTagged] = useState<string | null>(null);
  const [audioId, setAudioId] = useState("a1");
  const [visibility, setVisibility] = useState<"public" | "followers" | "private">("public");
  const [preview, setPreview] = useState(false);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [gate, setGate] = useState<"camera" | "photos" | null>(null);
  const [rights, setRights] = useState(false); // content-rights consent — required before publish
  const [rightsError, setRightsError] = useState(false);

  // ---- Day 4: REAL upload pipeline (signed-in users; guests keep the preview mock) ----
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [uploadStage, setUploadStage] = useState<UploadStage>({ stage: "idle" });
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<UploadErrorCode | null>(null);
  const live = Boolean(auth.viewer);

  const onPickFile = async (f: File | null) => {
    setFileError(null);
    setUploadedVideoId(null);
    setUploadStage({ stage: "idle" });
    if (!f) return;
    const pre = precheckVideoFile(f);
    if (pre) {
      setFileError(pre);
      return;
    }
    const dur = await probeVideoDuration(f);
    if (dur < 1) {
      setFileError("invalid_duration");
      return;
    }
    setDurationSec(dur);
    setFile(f);
    setFileUrl(URL.createObjectURL(f));
  };

  const startUpload = () => {
    if (!file || !auth.sessionToken || uploadStage.stage === "uploading" || uploadStage.stage === "processing") return;
    void uploadDanceVideo({
      sessionToken: auth.sessionToken,
      file,
      durationSec,
      onStage: (s) => {
        setUploadStage(s);
        if (s.stage === "done") setUploadedVideoId(s.videoId);
      },
      callMutation: (ref, args) => convex.mutation(ref as never, args as never) as never,
    });
  };

  const fileErrorMessage: Record<UploadErrorCode, LString> = {
    unsupported_type: { en: "That file type isn't supported. Use MP4, MOV or WebM.", sq: "Ky lloj skedari nuk mbështetet. Përdor MP4, MOV ose WebM." },
    too_large: { en: "The video is too large (max 512 MB).", sq: "Videoja është shumë e madhe (maks. 512 MB)." },
    invalid_duration: { en: "Videos must be between 1 second and 10 minutes.", sq: "Videot duhet të jenë nga 1 sekonda deri në 10 minuta." },
    too_many_pending: { en: "You have too many uploads in progress. Finish or delete one first.", sq: "Ke shumë ngarkime në rrugë. Përfundoji ose fshiji një të parën." },
    upload_window_expired: { en: "The upload session expired — please try again.", sq: "Seanca e ngarkimit skadoi — provo përsëri." },
    blob_missing: { en: "The upload didn't reach storage. Please retry.", sq: "Ngarkimi nuk arriti në ruajtje. Provo përsëri." },
    network: { en: "Network interrupted. Check your connection and retry.", sq: "Rrjeti u ndërpre. Kontrollo lidhjen dhe provo përsëri." },
    aborted: { en: "Upload cancelled.", sq: "Ngarkimi u anulua." },
    unauthenticated: { en: "Sign in to upload videos.", sq: "Hyr në llogari për të ngarkuar video." },
    not_resumable: { en: "That upload can't be resumed — start a new one.", sq: "Ky ngarkim nuk mund të vazhdojë — nis një të ri." },
    upload_failed: { en: "Upload failed. Please try again.", sq: "Ngarkimi dështoi. Provo përsëri." },
  };

  // 54: remix/duet/download — age-safe defaults, creator can change any time
  const reuseDefaults = reuseDefaultsFor(gov.ageBandValue);
  const [allowRemix, setAllowRemix] = useState(reuseDefaults.allowRemix);
  const [allowDuet, setAllowDuet] = useState(reuseDefaults.allowDuet);

  const video = source === "photo" ? undefined : VID.portrait;
  const cover = [IMG.catHipHop, IMG.catCommercial, IMG.catContemporary][["upload", "record", "photo"].indexOf(source)] ?? IMG.catHipHop;

  // age-aware defaults downgrade public visibility for minors
  const minor = gov.ageBandValue !== "adult";
  const effVisibility = minor && visibility === "public" ? ("followers" as const) : visibility;

  const claimHits = scanClaims(caption);

  // Auto-publish once the real upload finishes (publish pressed during upload).
  const publishPending = useRef(false);
  useEffect(() => {
    if (publishPending.current && uploadStage.stage === "done" && uploadedVideoId) {
      publishPending.current = false;
      void publish();
    }
  }, [uploadStage, uploadedVideoId]);

  // 53: pre-publication safety check
  const videoCheck = scanVideoSubmission({
    caption,
    hashtags,
    audioLicensed: true, // audios come from the in-app licensed registry
    creatorIsMinor: minor,
  });

  const publish = async () => {
    if (!rights) {
      setRightsError(true);
      return;
    }
    // Signed-in + real file → REAL pipeline: upload, then publish via createPost.
    if (live && file) {
      if (!uploadedVideoId) {
        publishPending.current = true;
        startUpload();
        return; // publish continues from the upload-stage watcher effect below
      }
      try {
        const res = await createPostLive({
          sessionToken: auth.sessionToken!,
          caption: caption.trim() || "New on Densen ✨",
          hashtags: hashtags.length ? hashtags : ["#densen"],
          style,
          visibility: effVisibility,
          audioLicensed: true,
          videoId: uploadedVideoId,
          // Day 7 lineage — the server re-checks the original creator's
          // reuse permission; these ids are never trusted client-side.
          remixOfPostId: remixOf ?? undefined,
          duetOfPostId: duetOf ?? undefined,
        });
        if (res?.ok) {
          setPublishedId(String(res.postId));
        } else {
          if (res.error === "reuse_not_allowed") {
            toast(t("gov.reuse.offBySafety"));
          }
          setFileError((res.error as UploadErrorCode) ?? "upload_failed");
          setUploadStage({ stage: "failed", error: (res.error as UploadErrorCode) ?? "upload_failed" });
        }
      } catch {
        setFileError("network");
        setUploadStage({ stage: "failed", error: "network" });
      }
      return;
    }
    // Guest/preview path (unchanged mock behavior).
    const id = `up_${Date.now()}`;
    const post: Post = {
      id,
      userId: "me",
      video: video ?? VID.portrait,
      cover,
      style,
      caption: caption.trim() || "New on Densen ✨",
      hashtags: hashtags.length ? hashtags : ["#densen"],
      audioId,
      likes: 0,
      comments: [],
      shares: 0,
      views: 0,
    };
    addPost(post);
    setPublishedId(id);
  };

  if (publishedId) {
    return (
      <Page>
        <div style={{ textAlign: "center", padding: "70px 0" }} className="anim-rise">
          <div style={{ fontSize: 54, marginBottom: 14 }}>🎉</div>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>{t("create.posted")}</h1>
          <p className="muted" style={{ margin: "0 0 26px", fontSize: 14.5 }}>{t("create.postedSub")}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={() => nav("/")}>{t("feed.forYou")} →</button>
            <button className="btn" onClick={() => nav("/profile")}>{t("nav.profile")}</button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 4 }}>{t("create.title")}</h1>
      <p className="muted" style={{ margin: "0 0 20px", fontSize: 14 }}>
        {challengeId ? `🏆 ${t("challenges.submitVideo")}` : t("create.tabPost")}
      </p>

      {/* source selector — permission gated: explain first, then the OS prompt */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {(["upload", "record", "photo"] as const).map((s) => (
          <button
            key={s}
            className={`chip${source === s ? " active" : ""}`}
            onClick={() => {
              setSource(s);
              const need = s === "record" ? "camera" : s === "upload" ? "photos" : null;
              const st = need ? gov.perms[need] : "granted";
              if (need && st !== "granted") setGate(need);
            }}
          >
            {s === "upload" ? `📁 ${t("create.upload")}` : s === "record" ? `⏺ ${t("create.record")}` : `🖼 ${t("create.photo")}`}
          </button>
        ))}
      </div>

      {/* media preview area — the real picked file replaces the demo reel */}
      <div style={{ position: "relative", borderRadius: "var(--radius-lg)", overflow: "hidden", aspectRatio: preview ? "9/16" : "16/9", maxWidth: preview ? 320 : undefined, margin: preview ? "0 auto 16px" : "0 0 16px", transition: "all 0.3s ease", background: "#000", border: "1px solid var(--line)" }}>
        {fileUrl ? (
          <video src={fileUrl} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : video ? (
          <video src={video} poster={cover} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <img src={cover} alt="" className="media-cover" />
        )}
        <span className="chip" style={{ position: "absolute", top: 10, right: 10, background: "rgba(10,12,16,0.75)", fontSize: 11 }}>
          {t("create.preview")}: {preview ? "9:16" : "16:9"}
        </span>
      </div>

      {/* REAL upload: file picker + progress + errors (signed-in users only) */}
      {live && (
        <div className="panel" style={{ padding: 14, marginBottom: 20 }}>
          <strong style={{ fontSize: 13.5, display: "block", marginBottom: 4 }}>📁 {lang === "sq" ? "Videoja jote" : "Your video"}</strong>
          <p className="faint" style={{ fontSize: 12, margin: "0 0 10px" }}>
            {lang === "sq"
              ? "MP4, MOV ose WebM · deri në 512 MB · 1 sek – 10 min. Videoja ngarkohet direkt në Densen kur publikon."
              : "MP4, MOV or WebM · up to 512 MB · 1 s – 10 min. The video uploads directly to Densen when you publish."}
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              ref={fileInput}
              type="file"
              accept={UPLOAD_ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
            <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
              {file ? (lang === "sq" ? "Ndrysho videon" : "Change video") : lang === "sq" ? "Zgjidh videon" : "Choose video"}
            </button>
            {file && (
              <span className="faint" style={{ fontSize: 12 }}>
                {(file.size / (1024 * 1024)).toFixed(1)} MB · {durationSec.toFixed(1)}s
              </span>
            )}
          </div>
          {file && uploadStage.stage === "idle" && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={startUpload}>
              ⬆ {lang === "sq" ? "Ngarko tani" : "Upload now"}
            </button>
          )}
          {(() => {
            const meta = uploadStatusMeta(uploadStage);
            if (!meta && !(uploadStage.stage === "failed" && fileError)) return null;
            const label =
              uploadStage.stage === "failed" && fileError
                ? tx(fileErrorMessage[uploadStage.error] ?? GENERIC_UPLOAD_ERROR, lang)
                : meta
                  ? tx(meta.labelKey!, lang)
                  : "";
            const icon = uploadStage.stage === "failed" ? "⚠️" : meta!.icon;
            const pct = uploadStage.stage === "failed" ? null : meta!.pct;
            const color = uploadStage.stage === "failed" ? "var(--err)" : "inherit";
            return (
              <div style={{ marginTop: 12 }} role="status" aria-live="polite">
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color }}>
                  <span aria-hidden>{icon}</span>
                  <span style={{ flex: 1 }}>{label}</span>
                  {pct !== null && <span className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>{pct}%</span>}
                </div>
                {pct !== null && (
                  <div className="bar" style={{ marginTop: 8 }} aria-hidden>
                    <span style={{ width: `${pct}%`, background: "var(--gold)" }} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <button className={`chip${preview ? "" : " active"}`} onClick={() => setPreview(false)}>16:9</button>
        <button className={`chip${preview ? " active" : ""}`} onClick={() => setPreview(true)}>9:16</button>
        <span className="faint" style={{ fontSize: 12, alignSelf: "center" }}>{t("create.preview")}</span>
      </div>

      {/* form */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label className="eyebrow" style={{ display: "block", marginBottom: 7 }}>{t("create.caption")}</label>
          <textarea className="input" placeholder={t("create.captionPlaceholder")} value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>

        <div>
          <label className="eyebrow" style={{ display: "block", marginBottom: 7 }}>{t("create.hashtags")}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {hashtags.map((h) => (
              <span key={h} className="chip active" onClick={() => setHashtags((hs) => hs.filter((x) => x !== h))} style={{ cursor: "pointer" }}>
                {h} ✕
              </span>
            ))}
          </div>
          <input
            className="input"
            placeholder="#hiphop"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput.trim()) {
                setHashtags((hs) => [...new Set([...hs, tagInput.trim().startsWith("#") ? tagInput.trim() : `#${tagInput.trim()}`])]);
                setTagInput("");
              }
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="eyebrow" style={{ display: "block", marginBottom: 7 }}>{t("create.style")}</label>
            <select className="input" value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="eyebrow" style={{ display: "block", marginBottom: 7 }}>{t("create.visibility")}</label>
            <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
              <option value="public">🌐 {t("create.visibilityPublic")}</option>
              <option value="followers">👥 {t("create.visibilityFollowers")}</option>
              <option value="private">🔒 {t("create.visibilityPrivate")}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="eyebrow" style={{ display: "block", marginBottom: 7 }}>{t("create.tagDancer")}</label>
          <select className="input" value={tagged ?? ""} onChange={(e) => setTagged(e.target.value || null)}>
            <option value="">—</option>
            {allPosts.slice(0, 6).map((p) => (
              <option key={p.userId} value={p.userId}>
                @{userById(p.userId).username}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="eyebrow" style={{ display: "block", marginBottom: 7 }}>
            <IcMusic size={13} /> {t("create.music")}
          </label>
          <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {audios.map((a) => (
              <button key={a.id} className={`chip${audioId === a.id ? " active" : ""}`} onClick={() => setAudioId(a.id)}>
                🎵 {a.name} · {a.dur}
              </button>
            ))}
          </div>
        </div>

        {/* 53: automated safety check — live, with reasons */}
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13.5 }}>🛡 {t("gov.create.safetyCheck")}</strong>
            <span
              className={`status ${videoCheck.status === "clean" ? "pass" : videoCheck.status === "review" ? "warning" : "action_required"}`}
              role="status"
            >
              <span aria-hidden>{videoCheck.status === "clean" ? "✓" : videoCheck.status === "review" ? "!" : "✕"}</span>
              {publishStatusLabel(videoCheck.status)[lang]}
            </span>
          </div>
          {videoCheck.signals.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, display: "grid", gap: 4 }}>
              {videoCheck.signals.map((s, i) => (
                <li key={i} style={{ color: s.severity === "block" ? "var(--err)" : s.severity === "review" ? "var(--warn)" : "var(--ink-faint)" }}>
                  {tx(s.label, lang)}
                </li>
              ))}
            </ul>
          )}
          <p className="faint" style={{ fontSize: 11.5, margin: "8px 0 0" }}>{t("gov.create.safetyWhy")}</p>
        </div>

        {/* 54: remix / duet / download controls */}
        <div className="panel" style={{ padding: 14 }}>
          <strong style={{ fontSize: 13.5, display: "block", marginBottom: 4 }}>🤝 {t("gov.reuse.duet")} · {t("gov.reuse.remix")}</strong>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {([
              ["remix", t("gov.reuse.remix"), allowRemix, (v: boolean) => setAllowRemix(v), reuseDefaults.allowRemix] as const,
              ["duet", t("gov.reuse.duet"), allowDuet, (v: boolean) => setAllowDuet(v), reuseDefaults.allowDuet] as const,
            ]).map(([key, label, val, set, defaultOn]) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, cursor: "pointer" }}>
                <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} />
                <span style={{ flex: 1 }}>{label}</span>
                {!val && !defaultOn && <span className="faint" style={{ fontSize: 11.5 }}>{t("gov.reuse.offBySafety")}</span>}
              </label>
            ))}
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              ⬇ {t("gov.reuse.download")}: <strong>{t("gov.reuse.offBySafety")}</strong> — {lang === "sq" ? "shkarkimet mbeten jashtë platformës për të mbrojtur kërcimtarët e rinj." : "downloads stay off platform-wide to protect young dancers."}
            </p>
          </div>
        </div>

        {/* content rights consent — required, unbundled from anything else */}
        <div className="panel" style={{ padding: 14, borderColor: rightsError ? "rgba(248,113,113,0.5)" : "var(--line)" }}>
          <div className="checkbox-row">
            <input id="cr-rights" type="checkbox" checked={rights} onChange={(e) => { setRights(e.target.checked); setRightsError(false); }} />
            <label htmlFor="cr-rights">
              {lang === "sq"
                ? "Konfirmoj se kam të drejtat për videon, muzikën dhe koreografinë në këtë postim, ose që është përdorim i drejtë me kreditim."
                : "I confirm I have the rights to the video, music and choreography in this post, or that it is credited fair use."}
            </label>
          </div>
          {rightsError && (
            <p role="alert" style={{ color: "var(--err)", fontSize: 12.5, fontWeight: 700, marginTop: 4 }}>⚠ {lang === "sq" ? "Prano të drejtat e përmbajtjes për të publikuar." : "Accept the content-rights terms to publish."}</p>
          )}
          {claimHits.length > 0 && (
            <p style={{ color: "var(--warn)", fontSize: 12.5, fontWeight: 700, marginTop: 6 }}>
              ⚠ {tx({ en: "CLAIM REQUIRES VERIFICATION", sq: "PRETENDIMI KERKON VERIFIKIM" }, lang)} — {claimHits.map((h) => tx(h.pattern, lang)).join(" · ")}
            </p>
          )}
        </div>

        {minor && effVisibility !== "public" && (
          <p className="faint" style={{ fontSize: 12 }}>
            🛡️ {t("settings.under16")} — {t("create.visibility")}: {t("create.visibilityFollowers")}
          </p>
        )}

        <button className="btn btn-primary" style={{ padding: "14px 22px", fontSize: 15, marginTop: 6 }} onClick={publish}>
          <IcCheck size={18} /> {t("create.publish")}
        </button>
      </div>

      {gate && (
        <PermissionGate
          permission={gate === "camera" ? "camera" : "photos"}
          onDone={() => setGate(null)}
        >
          {null}
        </PermissionGate>
      )}
    </Page>
  );
}

/* ---------------- duet flow ---------------- */
export function Duet() {
  const { postId } = useParams();
  const { t, toast } = useStore();
  const nav = useNavigate();
  // All hooks run unconditionally BEFORE any early return (hook-order safety).
  const [layout, setLayout] = useState<"side" | "follow" | "variation">("side");
  const post = posts.find((p) => p.id === postId);

  if (!post) return <Page><Empty icon="🔍" text="Post not found" /></Page>;

  const original = userById(post.userId);
  return (
    <Page>
      <button onClick={() => nav(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>← {t("common.back")}</button>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>{t("create.tabDuet")}</h1>
      <p className="muted" style={{ margin: "0 0 18px", fontSize: 13.5 }}>
        {t("create.duetWith")} <strong>@{original.username}</strong>
      </p>

      {/* duet stage — layout selector actually drives the stage */}
      <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", background: "#000", border: "1px solid var(--line)", marginBottom: 14 }}>
        {layout === "side" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", aspectRatio: "9/16", maxHeight: "62dvh", margin: "0 auto" }}>
            <video src={post.video} poster={post.cover} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <video src={VID.portrait} poster={IMG.extra5} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
          </div>
        )}
        {layout === "follow" && (
          <div style={{ position: "relative", aspectRatio: "9/16", maxHeight: "62dvh", margin: "0 auto" }}>
            <video src={post.video} poster={post.cover} autoPlay muted loop playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            <video src={VID.portrait} poster={IMG.extra5} autoPlay muted loop playsInline style={{ position: "absolute", right: 10, bottom: 10, width: "34%", aspectRatio: "9/16", objectFit: "cover", borderRadius: 10, border: "1px solid var(--gold-line)" }} />
          </div>
        )}
        {layout === "variation" && (
          <video src={VID.portrait} poster={IMG.extra5} autoPlay muted loop playsInline style={{ width: "100%", aspectRatio: "9/16", maxHeight: "62dvh", objectFit: "cover" }} />
        )}
      </div>

      <div className="muted" style={{ fontSize: 13, marginBottom: 16, textAlign: "center" }}>
        {t("feed.originalBy")} <strong className="gold-text">@{original.username}</strong> · {t("feed.performedBy")} <strong>@{ME_NAME}</strong>
      </div>

      {/* layouts */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
        {([
          { id: "side", label: `⬛⬛ ${t("create.duetSide")}` },
          { id: "follow", label: `🫱 ${t("create.duetFollow")}` },
          { id: "variation", label: `✨ ${t("create.duetVariation")}` },
        ] as const).map((o) => (
          <button key={o.id} className={`chip${layout === o.id ? " active" : ""}`} onClick={() => setLayout(o.id)}>
            {o.label}
          </button>
        ))}
      </div>

      {/* original versions */}
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t("feed.viewVersions")}</h2>
        <div style={{ display: "flex", gap: 10, overflowX: "auto" }} className="no-scrollbar">
          {posts.filter((p) => p.duetOf === post.id || p.id === post.id).map((p) => (
            <div key={p.id} style={{ flex: "0 0 110px" }}>
              <div style={{ position: "relative", aspectRatio: "9/16", borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)" }}>
                <img src={p.cover} alt="" className="media-cover" />
                <span style={{ position: "absolute", left: 7, bottom: 7, fontSize: 10.5, fontWeight: 700, textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>
                  @{userById(p.userId).username}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 54: the original creator's duet setting gates the whole flow */}
      {(() => {
        const creatorU = users.find((x) => x.id === post.userId);
        const allowed = canReuse(creatorU?.minor ? "teen13_15" : "adult", undefined, "duet");
        if (!allowed)
          return (
            <p className="muted" role="note" style={{ padding: 14, border: "1px solid var(--gold-line)", borderRadius: 12, background: "var(--gold-soft)", fontSize: 13, lineHeight: 1.6 }}>
              🛡 {t("gov.reuse.duetOff")} — @{original.username} {t("gov.reuse.offBySafety").toLowerCase()}.
            </p>
          );
        return (
          <button className="btn btn-primary" style={{ width: "100%", padding: "14px 22px", fontSize: 15 }} onClick={() => { toast(t("create.posted")); nav("/create"); }}>
            ⏺ {t("create.record")} & {t("create.publish")}
          </button>
        );
      })()}
    </Page>
  );
}

const ME_NAME = "bledi.dances";

/**
 * Day 7 — Remix page (/remix/:postId).
 * "Create your version of this choreography." Shows the original side-by-side
 * with the dancer's own take (layout selectable), then deep-links into the
 * real Create composer with `?remix=<postId>` so the actual publish pipeline
 * (upload → createPost with server-verified lineage) carries the attribution.
 */
export function Remix() {
  const { postId } = useParams();
  const { t, toast } = useStore();
  const nav = useNavigate();
  const auth = useAuth();
  const [layout, setLayout] = useState<"side" | "variation">("side");
  const original = posts.find((p) => p.id === postId);

  if (!original) return <Page><Empty icon="🔍" text="Post not found" /></Page>;

  const originalUser = userById(original.userId);
  const enter = () => {
    if (!auth.viewer) {
      toast(t("create.signInToRemix"));
      nav("/auth");
      return;
    }
    nav(`/create?remix=${original.id}`);
  };

  return (
    <Page>
      <button onClick={() => nav(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>← {t("common.back")}</button>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 2 }}>{t("act.remix")}</h1>
      <p className="muted" style={{ margin: "0 0 18px", fontSize: 13.5 }}>
        {t("act.remixDesc")} <strong>@{originalUser.username}</strong>
      </p>

      {/* remix stage — original and your take, side-by-side or full variation */}
      <div style={{ borderRadius: "var(--radius-lg)", overflow: "hidden", background: "#000", border: "1px solid var(--line)", marginBottom: 14 }}>
        {layout === "side" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", aspectRatio: "9/16", maxHeight: "62dvh", margin: "0 auto" }}>
            <video src={original.video} poster={original.cover} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <video src={VID.portrait} poster={IMG.extra5} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        ) : (
          <video src={VID.portrait} poster={IMG.extra5} autoPlay muted loop playsInline style={{ width: "100%", aspectRatio: "9/16", maxHeight: "62dvh", objectFit: "cover" }} />
        )}
      </div>

      <div className="muted" style={{ fontSize: 13, marginBottom: 16, textAlign: "center" }}>
        {t("feed.originalBy")} <strong className="gold-text">@{originalUser.username}</strong>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {([
          { id: "side", label: `⬛⬛ ${t("create.remixSide")}` },
          { id: "variation", label: `✨ ${t("create.remixVariation")}` },
        ] as const).map((o) => (
          <button key={o.id} className={`chip${layout === o.id ? " active" : ""}`} onClick={() => setLayout(o.id)}>
            {o.label}
          </button>
        ))}
      </div>

      <button className="btn btn-primary" style={{ width: "100%", padding: "14px 22px", fontSize: 15 }} onClick={enter}>
        🔁 {t("act.remix")} · {t("create.publish")}
      </button>
    </Page>
  );
}
