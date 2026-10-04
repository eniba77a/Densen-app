/**
 * DENSEN — Teacher Studio (Day 8, Day 23 Teacher Mode core).
 * ==========================================================
 * The publishing home for VERIFIED teachers only. Access is decided by the
 * server core (`studio.ts`) against the session token + teacherProfiles row —
 * the UI's gate is a mirror, never the authority. Sections:
 * Dashboard · My Lessons (merged) · Moves · Combos · Choreographies ·
 * Classes · Courses · Challenges · Students · Analytics.
 *
 * Day 23 — FREE PLATFORM: no price, no credit unlock, no revenue tab. Every
 * lesson is free. New capabilities: real video upload (Day 4 pipeline) with
 * preview-before-publish, optional teacher movement timestamps, delete for
 * the teacher's OWN items, and Draft/Published states with honest upload
 * progress (Preparing/Uploading/Processing/Failed).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useConvex } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Page, StatCard, Empty, LevelBadge } from "../components/ui";
import { useAuth } from "../state/auth";
import { useT, type TKey } from "../i18n";
import { useStore } from "../state/store";
import {
  precheckVideoFile,
  probeVideoDuration,
  uploadDanceVideo,
  type UploadErrorCode,
  type UploadStage,
} from "../lib/videoUpload";
import { tx } from "../components/gov-ui";

/* ---------------- studio vocabulary (mirror of convex/studio.ts) ---------------- */

type StudioKind = "move" | "combo" | "choreography" | "class" | "course" | "challenge";
type StudioStatus = "draft" | "published" | "unpublished";
type StudioDifficulty = "beginner" | "intermediate" | "advanced";
type StudioVisibility = "public" | "followers" | "private";

const KIND_TABLE: Record<StudioKind, string> = {
  move: "moves",
  combo: "combos",
  choreography: "choreographies",
  class: "classes",
  course: "courses",
  challenge: "challenges",
};

const KIND_KEY: Record<StudioKind, TKey> = {
  move: "studio.tab.moves",
  combo: "studio.tab.combos",
  choreography: "studio.tab.choreos",
  class: "studio.tab.classes",
  course: "studio.tab.courses",
  challenge: "studio.tab.challenges",
};

const STATUS_KEY: Record<StudioStatus, TKey> = {
  draft: "studio.status_draft",
  published: "studio.status_published",
  unpublished: "studio.status_unpublished",
};

const STYLES = ["Beginner", "Hip-Hop", "Commercial", "Contemporary", "Jazz", "Latin", "Kids", "Teens", "Advanced", "Professional"];

const fmtDur = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

/** A teacher movement timestamp (Practice Mode seeks to atSec). */
interface StepDraft {
  label: string;
  atSec: number;
}

interface StudioItem {
  id: string;
  kind: StudioKind;
  title: string;
  description: string;
  style: string;
  difficulty: string;
  durationSec: number;
  tags: string[];
  visibility: string;
  videoRef?: string;
  thumbnailRef?: string;
  videoUrl?: string;
  steps: StepDraft[];
  status: StudioStatus;
  deadlineAt?: number;
  updatedAt: number;
}

type Tab = "dashboard" | "lessons" | StudioKind | "students" | "analytics";

/* ------------------------------------------------------------------ */

export default function Studio({ initialView, initialNew }: { initialView?: "lessons"; initialNew?: StudioKind }) {
  const { t } = useT();
  const { sessionToken, viewer, loading } = useAuth();
  const [tab, setTab] = useState<Tab>(initialView === "lessons" ? "lessons" : initialNew ? initialNew : "dashboard");
  const [creating, setCreating] = useState<StudioKind | null>(initialNew ?? null);
  const [editing, setEditing] = useState<StudioItem | null>(null);

  const access = useQuery(
    api.studioWire.getStudioOverview,
    sessionToken ? { sessionToken } : "skip"
  );
  const teacherErr = access && typeof access === "object" && "ok" in access && !access.ok ? access.error : null;

  if (loading) return null;
  if (!sessionToken || !viewer) {
    return (
      <Page>
        <Gate icon="🎬" text={t("studio.login_required")} />
      </Page>
    );
  }
  if (teacherErr) {
    const key: TKey =
      teacherErr === "teacher_pending"
        ? "studio.teacher_pending"
        : teacherErr === "teacher_rejected"
          ? "studio.teacher_rejected"
          : teacherErr === "teacher_revoked"
            ? "studio.teacher_revoked"
            : "studio.not_teacher";
    return (
      <Page>
        <Gate icon={teacherErr === "not_teacher" ? "🎓" : "⏳"} text={t(key)} />
      </Page>
    );
  }

  const counts = access && "ok" in access && access.ok ? access.counts : null;
  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: t("nav.dashboard") },
    { id: "lessons", label: t("nav.myLessons") },
    { id: "class", label: t("studio.tab.classes") },
    { id: "course", label: t("studio.tab.courses") },
    { id: "move", label: t("studio.tab.moves") },
    { id: "combo", label: t("studio.tab.combos") },
    { id: "choreography", label: t("studio.tab.choreos") },
    { id: "challenge", label: t("studio.tab.challenges") },
    { id: "students", label: t("studio.tab.students") },
    { id: "analytics", label: t("studio.tab.analytics") },
  ];

  return (
    <Page wide>
      <p className="muted" style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" }}>
        {t("studio.eyebrow")}
      </p>
      <h1 style={{ margin: "0 0 18px", fontFamily: "Sora", fontSize: 30, fontWeight: 800 }}>{t("studio.title")}</h1>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 18 }}>
        {tabs.map((x) => (
          <button
            key={x.id}
            className={`chip ${tab === x.id ? "active" : ""}`}
            style={{ whiteSpace: "nowrap", cursor: "pointer" }}
            onClick={() => {
              setTab(x.id);
              setCreating(null);
              setEditing(null);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      {counts && tab === "dashboard" && (
        <Dashboard counts={counts} students={access && "ok" in access && access.ok ? access.students : 0} />
      )}

      {tab === "lessons" && (
        <LessonsView editing={editing} setEditing={setEditing} creating={creating} setCreating={setCreating} />
      )}

      {(Object.keys(KIND_TABLE) as StudioKind[]).includes(tab as StudioKind) && (
        <KindSection
          kind={tab as StudioKind}
          creating={creating}
          setCreating={setCreating}
          editing={editing}
          setEditing={setEditing}
        />
      )}

      {tab === "students" && <Students />}
      {tab === "analytics" && <Analytics />}
    </Page>
  );
}

/* ---------------- gate + dashboard ---------------- */

function Gate({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="panel" style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>{icon}</div>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, maxWidth: 460, marginLeft: "auto", marginRight: "auto" }}>{text}</p>
    </div>
  );
}

type Counts = { moves: number; combos: number; choreographies: number; classes: number; courses: number; challenges: number; published: number; drafts: number };

function Dashboard({ counts, students }: { counts: Counts; students: number }) {
  const { t } = useT();
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatCard icon="✅" value={counts.published} label={t("studio.stat.published")} accent />
        <StatCard icon="📝" value={counts.drafts} label={t("studio.stat.drafts")} />
        <StatCard icon="🧑‍🎓" value={students} label={t("studio.stat.students")} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 12 }}>
        <StatCard icon="✨" value={counts.moves} label={t("studio.tab.moves")} />
        <StatCard icon="🧩" value={counts.combos} label={t("studio.tab.combos")} />
        <StatCard icon="🎭" value={counts.choreographies} label={t("studio.tab.choreos")} />
        <StatCard icon="🏫" value={counts.classes} label={t("studio.tab.classes")} />
        <StatCard icon="📚" value={counts.courses} label={t("studio.tab.courses")} />
        <StatCard icon="🏆" value={counts.challenges} label={t("studio.tab.challenges")} />
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 14 }}>✦ {t("studio.catalog_note")}</p>
    </div>
  );
}

/* ---------------- kind sections: list + create + edit ---------------- */

function KindSection({
  kind,
  creating,
  setCreating,
  editing,
  setEditing,
}: {
  kind: StudioKind;
  creating: StudioKind | null;
  setCreating: (k: StudioKind | null) => void;
  editing: StudioItem | null;
  setEditing: (i: StudioItem | null) => void;
}) {
  const { t } = useT();
  const { sessionToken } = useAuth();
  const { toast } = useStore();
  const [lessonsFor, setLessonsFor] = useState<string | null>(null);
  const items = useQuery(
    api.studioWire.listMyItems,
    sessionToken ? { sessionToken, kind } : "skip"
  );
  const transition = useMutation(api.studioWire.transitionStudioItem);
  const del = useMutation(api.studioWire.deleteStudioItem);

  const list: StudioItem[] =
    items && typeof items === "object" && "ok" in items && items.ok ? (items.items as unknown as StudioItem[]) : [];

  const doTransition = async (itemId: string, action: "publish" | "unpublish" | "revert_to_draft") => {
    if (!sessionToken) return;
    try {
      const res = await transition({ sessionToken, kind, itemId, action });
      if (res?.ok) toast(t(action === "publish" ? "studio.published_toast" : "studio.unpublished_toast"));
      else if (res && "error" in res) toast(t(`studio.err.${res.error}` as TKey));
    } catch {
      toast(t("studio.err.network"));
    }
  };

  const doDelete = async (itemId: string) => {
    if (!sessionToken || !window.confirm(t("studio.deleteConfirm"))) return;
    try {
      const res = await del({ sessionToken, kind, itemId });
      if (res?.ok) toast(t("studio.deleted_toast"));
      else if (res && "error" in res) toast(t(`studio.err.${res.error}` as TKey));
    } catch {
      toast(t("studio.err.network"));
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "Sora", fontSize: 20, fontWeight: 800 }}>{t(KIND_KEY[kind])}</h2>
        <button className="btn btn-primary btn-sm" onClick={() => { setCreating(kind); setEditing(null); }}>
          + {t("studio.create")}
        </button>
      </div>

      {creating === kind && <ItemForm kind={kind} onDone={() => setCreating(null)} />}
      {editing && editing.kind === kind && <ItemForm kind={kind} existing={editing} onDone={() => setEditing(null)} />}

      {list.length === 0 ? (
        <Empty icon="🗂️" text={t("studio.empty")} />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {list.map((it) => (
            <div key={it.id} className="panel panel-hover" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontFamily: "Sora" }}>{it.title}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {it.style} · <LevelBadge level={it.difficulty.charAt(0).toUpperCase() + it.difficulty.slice(1)} /> · {fmtDur(it.durationSec)}
                    {" · ✦ "}{t("learn.access.free")}
                    {it.videoRef ? " · 🎬" : ""}
                    {it.steps.length > 0 ? ` · 📑 ${it.steps.length}` : ""}
                  </div>
                </div>
                <StatusBadge status={it.status} />
              </div>
              {it.deadlineAt ? <div className="muted" style={{ fontSize: 12 }}>🏆 {new Date(it.deadlineAt).toLocaleDateString()}</div> : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {it.status !== "published" && (
                  <button className="btn btn-primary btn-sm" onClick={() => doTransition(it.id, "publish")}>{t("studio.publish")}</button>
                )}
                {it.status === "published" && (
                  <button className="btn btn-sm" onClick={() => doTransition(it.id, "unpublish")}>{t("studio.unpublish")}</button>
                )}
                <button className="btn btn-sm" onClick={() => { setEditing(it); setCreating(null); }}>{t("studio.edit")}</button>
                <button className="btn btn-sm btn-danger" onClick={() => doDelete(it.id)}>{t("studio.delete")}</button>
                {kind === "course" && it.status !== "draft" && (
                  <button className="btn btn-sm" onClick={() => setLessonsFor(lessonsFor === it.id ? null : it.id)}>
                    🎬 {t("studio.lessons.manage")}
                  </button>
                )}
              </div>
              {kind === "course" && lessonsFor === it.id && <CourseLessonManager courseId={it.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StudioStatus }) {
  const { t } = useT();
  const color = status === "published" ? "#4ade80" : status === "draft" ? "var(--gold)" : "#f87171";
  const bg = status === "published" ? "rgba(74,222,128,0.16)" : status === "draft" ? "rgba(227,179,65,0.16)" : "rgba(248,113,113,0.16)";
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: bg, color, height: "fit-content" }}>
      {t(STATUS_KEY[status])}
    </span>
  );
}

/* ---------------- Day 23 — upload stage + error labels (bilingual) ---------------- */

const uploadStageLabel = (s: UploadStage, lang: "en" | "sq"): string => {
  switch (s.stage) {
    case "preparing":
      return tx({ en: "Preparing upload…", sq: "Përgatitja e ngarkimit…" }, lang);
    case "uploading":
      return tx({ en: `Uploading video… ${s.percent}%`, sq: `Ngarkimi i videos… ${s.percent}%` }, lang);
    case "processing":
      return tx({ en: "Processing…", sq: "Përpunimi…" }, lang);
    case "thumbnail":
      return tx({ en: `Capturing thumbnail… ${s.percent}%`, sq: `Kapja e miniaturës… ${s.percent}%` }, lang);
    case "done":
      return tx({ en: "Upload complete — ready to publish", sq: "Ngarkimi përfundoi — gati për publikim" }, lang);
    default:
      return "";
  }
};

const uploadErrorLabel = (code: UploadErrorCode, lang: "en" | "sq"): string => {
  const map: Partial<Record<UploadErrorCode, { en: string; sq: string }>> = {
    unsupported_type: { en: "That file type isn't supported. Use MP4, MOV or WebM.", sq: "Ky lloj skedari nuk mbështetet. Përdor MP4, MOV ose WebM." },
    too_large: { en: "The video is too large (max 512 MB).", sq: "Videoja është shumë e madhe (maks. 512 MB)." },
    invalid_duration: { en: "Videos must be between 1 second and 10 minutes.", sq: "Videot duhet të jenë nga 1 sekonda deri në 10 minuta." },
    too_many_pending: { en: "You have too many uploads in progress.", sq: "Ke shumë ngarkime në rrugë." },
    upload_window_expired: { en: "The upload session expired — try again.", sq: "Seanca e ngarkimit skadoi — provo përsëri." },
    blob_missing: { en: "The upload didn't reach storage. Retry.", sq: "Ngarkimi nuk arriti në ruajtje. Provo përsëri." },
    network: { en: "Network interrupted. Retry.", sq: "Rrjeti u ndërpre. Provo përsëri." },
    aborted: { en: "Upload cancelled.", sq: "Ngarkimi u anulua." },
    unauthenticated: { en: "Sign in to upload videos.", sq: "Hyr në llogari për të ngarkuar video." },
  };
  return tx(map[code] ?? { en: "Upload failed. Please try again.", sq: "Ngarkimi dështoi. Provo përsëri." }, lang);
};

function ItemForm({ kind, existing, onDone }: { kind: StudioKind; existing?: StudioItem; onDone: () => void }) {
  const { t, lang } = useT();
  const { sessionToken } = useAuth();
  const { toast } = useStore();

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [style, setStyle] = useState(existing?.style ?? STYLES[0]);
  const [difficulty, setDifficulty] = useState<StudioDifficulty>((existing?.difficulty as StudioDifficulty) ?? "beginner");
  const [minutes, setMinutes] = useState(Math.max(1, Math.round((existing?.durationSec ?? 300) / 60)));
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [visibility, setVisibility] = useState<StudioVisibility>((existing?.visibility as StudioVisibility) ?? "public");
  const [deadline, setDeadline] = useState(existing?.deadlineAt ? new Date(existing.deadlineAt).toISOString().slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  // Day 23 — real video upload through the Day 4 pipeline (Draft → uploading
  // → processing → ready), with preview-before-publish.
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [durSec, setDurSec] = useState(0);
  const [uploadStage, setUploadStage] = useState<UploadStage>({ stage: "idle" });
  const [videoRef, setVideoRef] = useState<string | undefined>(existing?.videoRef);
  // Day 23 — movement timestamps for class tutorials (Practice Mode seeks).
  const [steps, setSteps] = useState<StepDraft[]>(existing?.steps ?? []);

  const create = useMutation(api.studioWire.createStudioItem);
  const update = useMutation(api.studioWire.updateStudioItem);

  const myMoves = useQuery(
    api.studioWire.listMyItems,
    kind === "combo" && sessionToken ? { sessionToken, kind: "move" as const } : "skip"
  );
  const moveOptions: StudioItem[] =
    myMoves && typeof myMoves === "object" && "ok" in myMoves && myMoves.ok ? (myMoves.items as unknown as StudioItem[]) : [];
  const [comboMoveIds, setComboMoveIds] = useState<string[]>([]);
  const convex = useConvex();

  // Media resource cleanup: revoke the local preview URL when replaced.
  useEffect(() => () => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
  }, [fileUrl]);

  const onPickFile = async (f: File | null) => {
    setUploadStage({ stage: "idle" });
    if (!f) return;
    const pre = precheckVideoFile(f);
    if (pre) {
      setUploadStage({ stage: "failed", error: pre });
      return;
    }
    const dur = await probeVideoDuration(f);
    if (dur < 1) {
      setUploadStage({ stage: "failed", error: "invalid_duration" });
      return;
    }
    setDurSec(dur);
    setFile(f);
    setFileUrl(URL.createObjectURL(f));
  };

  const startUpload = () => {
    if (!file || !sessionToken || uploadStage.stage === "uploading" || uploadStage.stage === "processing") return;
    void uploadDanceVideo({
      sessionToken,
      file,
      durationSec: Math.round(durSec),
      onStage: (s) => {
        setUploadStage(s);
        if (s.stage === "done") setVideoRef(s.videoId);
      },
      callMutation: (ref, args) => convex.mutation(ref as never, args as never) as never,
    });
  };

  const submit = async () => {
    if (!sessionToken) return;
    setBusy(true);
    // Day 23 — always free. Movement timestamps are validated + sorted here
    // and re-validated server-side (normalizeSteps).
    const cleanSteps = steps
      .map((s) => ({ label: String(s.label ?? "").trim(), atSec: Number(s.atSec) }))
      .filter((s) => s.label.length > 0 && Number.isFinite(s.atSec) && s.atSec >= 0)
      .sort((a, b) => a.atSec - b.atSec);
    const base = {
      title: title.trim(),
      description,
      style,
      difficulty,
      durationSec: Math.round(minutes * 60),
      priceCents: 0,
      creditPrice: 0,
      tags: tags.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean),
      visibility,
      videoRef,
      ...(kind === "class" ? { steps: cleanSteps } : {}),
      ...(kind === "challenge" && deadline ? { deadlineAt: new Date(deadline + "T23:59:59").getTime() } : {}),
    };
    try {
      if (existing) {
        const res = await update({ sessionToken, kind, itemId: existing.id, ...base });
        if (res?.ok) {
          toast(t("studio.updated"));
          onDone();
        } else if (res && "error" in res) toast(t(`studio.err.${res.error}` as TKey));
      } else {
        const res = await create({ sessionToken, kind, ...base, ...(kind === "combo" ? { comboMoveIds } : {}) });
        if (res?.ok) {
          toast(t("studio.created", { kind: t(KIND_KEY[kind]) }));
          onDone();
        } else if (res && "error" in res) toast(t(`studio.err.${res.error}` as TKey));
      }
    } catch {
      toast(t("studio.err.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 16, display: "grid", gap: 12 }}>
      <strong style={{ fontFamily: "Sora" }}>{t("studio.create_title", { kind: t(KIND_KEY[kind]) })}</strong>

      <div>
        <label className="input-label">{t("studio.f.title")}</label>
        <input className="input" placeholder={t("studio.f.title_ph")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </div>

      <div>
        <label className="input-label">{t("studio.f.desc")}</label>
        <textarea className="input" placeholder={t("studio.f.desc_ph")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="input-label">{t("studio.f.style")}</label>
          <select className="input" value={style} onChange={(e) => setStyle(e.target.value)}>
            {STYLES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="input-label">{t("studio.f.difficulty")}</label>
          <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as StudioDifficulty)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
        <div>
          <label className="input-label">{t("studio.f.duration")}</label>
          <input className="input" type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
        <div>
          <label className="input-label">{t("studio.f.visibility")}</label>
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as StudioVisibility)}>
            <option value="public">Public</option>
            <option value="followers">Followers</option>
            <option value="private">Private</option>
          </select>
        </div>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>✦ {t("studio.freePlatform")}</span>

      <div>
        <label className="input-label">{t("studio.f.tags")}</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="commercial, footwork, 8count" />
      </div>

      {kind === "challenge" && (
        <div>
          <label className="input-label">{t("studio.f.deadline")}</label>
          <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      )}

      {kind === "combo" && (
        <div>
          <label className="input-label">{t("studio.f.combo_moves")}</label>
          {moveOptions.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>{t("studio.f.combo_moves_none")}</span>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {moveOptions.map((m) => (
                <button
                  key={m.id}
                  className={`chip ${comboMoveIds.includes(m.id) ? "active" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setComboMoveIds((ids) => (ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id]))}
                >
                  {m.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Day 23 — real upload through the Day 4 pipeline + preview */}
      <div className="panel" style={{ padding: 12, display: "grid", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>🎬 {t("studio.f.video")}</span>
        <input
          ref={fileInput}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          style={{ display: "none" }}
          onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
            {videoRef || file ? t("studio.f.videoChange") : t("studio.f.videoPick")}
          </button>
          {file && !videoRef && (
            <button
              className="btn btn-primary btn-sm"
              onClick={startUpload}
              disabled={uploadStage.stage === "uploading" || uploadStage.stage === "processing"}
            >
              ⬆️ {tx({ en: "Upload", sq: "Ngarko" }, lang)}
            </button>
          )}
          {videoRef && uploadStage.stage === "done" && (
            <span className="chip" style={{ fontSize: 11 }}>✅ {tx({ en: "Video attached", sq: "Video e bashkangjitur" }, lang)}</span>
          )}
        </div>
        {uploadStage.stage !== "idle" && (
          <p className="muted" style={{ fontSize: 12, margin: 0 }} role={uploadStage.stage === "failed" ? "alert" : "status"}>
            {uploadStage.stage === "failed" ? `⚠ ${uploadErrorLabel(uploadStage.error, lang)}` : uploadStageLabel(uploadStage, lang)}
          </p>
        )}
        {(fileUrl || existing?.videoUrl) && (
          <div>
            <span className="faint" style={{ fontSize: 11.5 }}>👁 {t("studio.f.preview")}</span>
            <video
              key={fileUrl ?? existing?.videoUrl}
              src={fileUrl ?? existing?.videoUrl}
              controls
              playsInline
              style={{ width: "100%", maxWidth: 340, borderRadius: 12, marginTop: 6, display: "block", background: "#000" }}
            />
          </div>
        )}
      </div>

      {/* Day 23 — movement timestamps (class tutorials) */}
      {kind === "class" && (
        <div>
          <label className="input-label">📑 {t("studio.f.steps")}</label>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={s.label}
                placeholder={t("studio.f.stepLabel")}
                maxLength={120}
                onChange={(e) => setSteps((rows) => rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
              />
              <input
                className="input"
                style={{ width: 96 }}
                type="number"
                min={0}
                step={0.5}
                value={s.atSec}
                aria-label={t("studio.f.stepAt")}
                onChange={(e) => setSteps((rows) => rows.map((r, j) => (j === i ? { ...r, atSec: Number(e.target.value) } : r)))}
              />
              <button className="btn btn-sm" aria-label={t("player.clear")} onClick={() => setSteps((rows) => rows.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-sm" disabled={steps.length >= 40} onClick={() => setSteps((rows) => [...rows, { label: "", atSec: 0 }])}>
              {t("studio.f.stepAdd")}
            </button>
          </div>
          <p className="faint" style={{ fontSize: 11.5, margin: "6px 0 0" }}>{t("studio.f.stepsHint")}</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" disabled={busy || title.trim().length < 3} onClick={submit}>
          {busy ? "…" : existing ? t("studio.save") : t("studio.create")}
        </button>
        <button className="btn" onClick={onDone}>{t("studio.cancel")}</button>
      </div>
    </div>
  );
}

/* ---------------- Day 23 — My Lessons: merged classes + courses ---------------- */

/**
 * The Teacher Mode "My Lessons" tab: every class and course the teacher owns
 * in one list with publish/unpublish, edit, delete and the course lesson
 * manager. Ownership is re-checked server-side on every action.
 */
function LessonsView({
  editing,
  setEditing,
  creating,
  setCreating,
}: {
  editing: StudioItem | null;
  setEditing: (i: StudioItem | null) => void;
  creating: StudioKind | null;
  setCreating: (k: StudioKind | null) => void;
}) {
  const { t } = useT();
  const { sessionToken } = useAuth();
  const { toast } = useStore();
  const [managing, setManaging] = useState<string | null>(null);

  const items = useQuery(api.studioWire.listMyItems, sessionToken ? { sessionToken } : "skip");
  const transition = useMutation(api.studioWire.transitionStudioItem);
  const del = useMutation(api.studioWire.deleteStudioItem);

  const all: StudioItem[] =
    items && typeof items === "object" && "ok" in items && items.ok ? (items.items as unknown as StudioItem[]) : [];
  const lessons = all
    .filter((i) => i.kind === "class" || i.kind === "course")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const doTransition = async (item: StudioItem, action: "publish" | "unpublish") => {
    if (!sessionToken) return;
    try {
      const res = await transition({ sessionToken, kind: item.kind, itemId: item.id, action });
      if (res?.ok) toast(t(action === "publish" ? "studio.published_toast" : "studio.unpublished_toast"));
      else if (res && "error" in res) toast(t(`studio.err.${res.error}` as TKey));
    } catch {
      toast(t("studio.err.network"));
    }
  };

  const doDelete = async (item: StudioItem) => {
    if (!sessionToken || !window.confirm(t("studio.deleteConfirm"))) return;
    try {
      const res = await del({ sessionToken, kind: item.kind, itemId: item.id });
      if (res?.ok) toast(t("studio.deleted_toast"));
      else if (res && "error" in res) toast(t(`studio.err.${res.error}` as TKey));
    } catch {
      toast(t("studio.err.network"));
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "Sora", fontSize: 20, fontWeight: 800 }}>{t("studio.lessonsView")}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => { setCreating("class"); setEditing(null); }}>
            + {t("studio.tab.classes")}
          </button>
          <button className="btn btn-sm" onClick={() => { setCreating("course"); setEditing(null); }}>
            + {t("studio.tab.courses")}
          </button>
        </div>
      </div>

      {creating === "class" && <ItemForm kind="class" onDone={() => setCreating(null)} />}
      {creating === "course" && <ItemForm kind="course" onDone={() => setCreating(null)} />}
      {editing && <ItemForm kind={editing.kind} existing={editing} onDone={() => setEditing(null)} />}

      {lessons.length === 0 ? (
        <Empty icon="🗂️" text={t("studio.empty")} />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {lessons.map((it) => (
            <div key={it.id} className="panel panel-hover" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ fontFamily: "Sora" }}>{it.title}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {it.kind === "class" ? t("studio.tab.classes") : t("studio.tab.courses")} · {it.style} ·{" "}
                    <LevelBadge level={it.difficulty.charAt(0).toUpperCase() + it.difficulty.slice(1)} /> · {fmtDur(it.durationSec)}
                    {it.videoRef ? " · 🎬" : ""}
                    {it.steps.length > 0 ? ` · 📑 ${it.steps.length}` : ""}
                  </div>
                </div>
                <StatusBadge status={it.status} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {it.status !== "published" && (
                  <button className="btn btn-primary btn-sm" onClick={() => doTransition(it, "publish")}>{t("studio.publish")}</button>
                )}
                {it.status === "published" && (
                  <button className="btn btn-sm" onClick={() => doTransition(it, "unpublish")}>{t("studio.unpublish")}</button>
                )}
                <button className="btn btn-sm" onClick={() => { setEditing(it); setCreating(null); }}>{t("studio.edit")}</button>
                <button className="btn btn-sm btn-danger" onClick={() => doDelete(it)}>{t("studio.delete")}</button>
                {it.kind === "course" && it.status !== "draft" && (
                  <button className="btn btn-sm" onClick={() => setManaging(managing === it.id ? null : it.id)}>
                    🎬 {t("studio.lessons.manage")}
                  </button>
                )}
              </div>
              {it.kind === "course" && managing === it.id && <CourseLessonManager courseId={it.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- course lesson manager (owner-gated) ---------------- */

/**
 * Add + list lessons for one of the teacher's own courses. The server
 * (`studioWire.createCourseLesson`) re-checks ownership, position, and
 * bounds on every call; this UI is only a mirror.
 */
function CourseLessonManager({ courseId }: { courseId: string }) {
  const { t } = useT();
  const { sessionToken } = useAuth();
  const { toast } = useStore();
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);

  const lessons = useQuery(
    api.studioWire.listCourseLessons,
    sessionToken ? { sessionToken, courseId } : "skip"
  );
  const add = useMutation(api.studioWire.createCourseLesson);

  const rows = lessons && typeof lessons === "object" && "ok" in lessons && lessons.ok ? lessons.lessons : [];

  const submit = async () => {
    if (!sessionToken) return;
    setBusy(true);
    try {
      const res = await add({
        sessionToken,
        courseId,
        title: title.trim(),
        durationSec: Math.round(minutes * 60),
      });
      if (res?.ok) {
        toast(t("studio.lesson.added"));
        setTitle("");
      } else if (res && "error" in res) {
        toast(t(`studio.err.${res.error}` as TKey));
      }
    } catch {
      toast(t("studio.err.network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ padding: 14, background: "var(--panel-2)" }}>
      <strong style={{ fontFamily: "Sora", fontSize: 14 }}>{t("studio.lessons.title")}</strong>
      {rows.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {rows.map((l) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(227,179,65,0.14)",
                  color: "var(--gold)",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {l.position}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</span>
              <span className="faint" style={{ fontSize: 12 }}>{fmtDur(l.durationSec)}</span>
              <span className="faint" style={{ fontSize: 12 }}>+{l.xpReward} XP</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 2, minWidth: 160 }}
          placeholder={t("studio.lesson.title_ph")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
        <input
          className="input"
          style={{ flex: 1, minWidth: 90 }}
          type="number"
          min={1}
          max={240}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          aria-label={t("studio.f.duration")}
        />
        <button className="btn btn-primary btn-sm" disabled={busy || title.trim().length < 3} onClick={submit}>
          {busy ? "…" : `+ ${t("studio.lessons.add")}`}
        </button>
      </div>
    </div>
  );}

/* ---------------- students / analytics / revenue ---------------- */

function Students() {
  const { t } = useT();
  const { sessionToken } = useAuth();
  const overview = useQuery(api.studioWire.getStudioOverview, sessionToken ? { sessionToken } : "skip");
  const students = overview && "ok" in overview && overview.ok ? overview.students : 0;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatCard icon="🧑‍🎓" value={students} label={t("studio.stat.students")} accent />
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        {t("studio.catalog_note")}
      </p>
    </div>
  );
}

function Analytics() {
  const { t } = useT();
  const { sessionToken } = useAuth();
  const data = useQuery(api.studioWire.getAnalytics, sessionToken ? { sessionToken } : "skip");
  if (!data || !("ok" in data) || !data.ok) return <Empty icon="📈" text={t("studio.empty")} />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
      <StatCard icon="🔥" value={data.likes} label={t("studio.analytics.likes")} accent />
      <StatCard icon="💬" value={data.comments} label={t("studio.analytics.comments")} />
      <StatCard icon="👁️" value={data.views} label={t("studio.analytics.views")} />
      <StatCard icon="🎯" value={data.practice} label={t("studio.analytics.practice")} />
      <StatCard icon="🏫" value={data.classesPublished} label={t("studio.analytics.classes")} />
      <StatCard icon="📚" value={data.coursesPublished} label={t("studio.analytics.courses")} />
      <StatCard icon="🎒" value={data.enrollments} label={t("studio.stat.enrollments")} />
    </div>
  );
}

