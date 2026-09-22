/**
 * DENSEN — Teacher Studio (Day 8).
 * ================================
 * The publishing home for VERIFIED teachers only. Access is decided by the
 * server core (`studio.ts`) against the session token + teacherProfiles row —
 * the UI's gate is a mirror, never the authority. Nine sections:
 * Dashboard · Moves · Combos · Choreographies · Classes · Courses ·
 * Challenges · Students · Analytics · Revenue.
 *
 * Create/update flows cover the six kinds with every Day 8 field: title,
 * description, video/thumbnail refs, style, difficulty, duration, price,
 * free/paid, credit unlock, tags, visibility. Items start as DRAFT and move
 * through PUBLISHED → UNPUBLISHED via server-validated transitions.
 * Revenue shows real accrual truth only — DENSEN never invents money.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Page, StatCard, Empty, LevelBadge } from "../components/ui";
import { useAuth } from "../state/auth";
import { useT, type TKey } from "../i18n";
import { useStore } from "../state/store";

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

const ACCESS_KEY: Record<string, TKey> = {
  free: "studio.access_free",
  paid: "studio.access_paid",
  credits: "studio.access_credits",
  paid_credits: "studio.access_paid_credits",
};

const STATUS_KEY: Record<StudioStatus, TKey> = {
  draft: "studio.status_draft",
  published: "studio.status_published",
  unpublished: "studio.status_unpublished",
};

const STYLES = ["Beginner", "Hip-Hop", "Commercial", "Contemporary", "Jazz", "Latin", "Kids", "Teens", "Advanced", "Professional"];

const accessModelOf = (p: { priceCents: number; creditPrice: number }): string =>
  p.priceCents <= 0 && p.creditPrice <= 0 ? "free" : p.priceCents > 0 && p.creditPrice > 0 ? "paid_credits" : p.priceCents > 0 ? "paid" : "credits";

const fmtDur = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const fmtEur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

interface StudioItem {
  id: string;
  kind: StudioKind;
  title: string;
  description: string;
  style: string;
  difficulty: string;
  durationSec: number;
  priceCents: number;
  creditPrice: number;
  tags: string[];
  visibility: string;
  status: StudioStatus;
  deadlineAt?: number;
  updatedAt: number;
}

type Tab = "dashboard" | StudioKind | "students" | "analytics" | "revenue";

/* ------------------------------------------------------------------ */

export default function Studio() {
  const { t } = useT();
  const { sessionToken, viewer, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [creating, setCreating] = useState<StudioKind | null>(null);
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
    { id: "dashboard", label: t("studio.tab.dashboard") },
    { id: "move", label: t("studio.tab.moves") },
    { id: "combo", label: t("studio.tab.combos") },
    { id: "choreography", label: t("studio.tab.choreos") },
    { id: "class", label: t("studio.tab.classes") },
    { id: "course", label: t("studio.tab.courses") },
    { id: "challenge", label: t("studio.tab.challenges") },
    { id: "students", label: t("studio.tab.students") },
    { id: "analytics", label: t("studio.tab.analytics") },
    { id: "revenue", label: t("studio.tab.revenue") },
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
      {tab === "revenue" && <Revenue />}
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
                    {it.style} · <LevelBadge level={it.difficulty.charAt(0).toUpperCase() + it.difficulty.slice(1)} /> · {fmtDur(it.durationSec)} · {t(ACCESS_KEY[accessModelOf({ priceCents: it.priceCents, creditPrice: it.creditPrice })])}
                    {it.priceCents > 0 ? ` · ${fmtEur(it.priceCents)}` : ""}
                    {it.creditPrice > 0 ? ` · ${it.creditPrice}💎` : ""}
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

function ItemForm({ kind, existing, onDone }: { kind: StudioKind; existing?: StudioItem; onDone: () => void }) {
  const { t } = useT();
  const { sessionToken } = useAuth();
  const { toast } = useStore();

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [style, setStyle] = useState(existing?.style ?? STYLES[0]);
  const [difficulty, setDifficulty] = useState<StudioDifficulty>((existing?.difficulty as StudioDifficulty) ?? "beginner");
  const [minutes, setMinutes] = useState(Math.max(1, Math.round((existing?.durationSec ?? 300) / 60)));
  const [priceEur, setPriceEur] = useState(existing?.priceCents ? (existing.priceCents / 100).toFixed(2) : "0");
  const [credits, setCredits] = useState(String(existing?.creditPrice ?? 0));
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [visibility, setVisibility] = useState<StudioVisibility>((existing?.visibility as StudioVisibility) ?? "public");
  const [deadline, setDeadline] = useState(existing?.deadlineAt ? new Date(existing.deadlineAt).toISOString().slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  const create = useMutation(api.studioWire.createStudioItem);
  const update = useMutation(api.studioWire.updateStudioItem);

  const myMoves = useQuery(
    api.studioWire.listMyItems,
    kind === "combo" && sessionToken ? { sessionToken, kind: "move" as const } : "skip"
  );
  const moveOptions: StudioItem[] =
    myMoves && typeof myMoves === "object" && "ok" in myMoves && myMoves.ok ? (myMoves.items as unknown as StudioItem[]) : [];
  const [comboMoveIds, setComboMoveIds] = useState<string[]>([]);

  const priceCents = Math.round(parseFloat(priceEur || "0") * 100);
  const creditPrice = Math.max(0, Math.round(parseFloat(credits || "0")));

  const submit = async () => {
    if (!sessionToken) return;
    setBusy(true);
    const base = {
      title: title.trim(),
      description,
      style,
      difficulty,
      durationSec: Math.round(minutes * 60),
      priceCents,
      creditPrice,
      tags: tags.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean),
      visibility,
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
        <div>
          <label className="input-label">{t("studio.f.price")}</label>
          <input className="input" type="number" min={0} max={30} step="0.5" value={priceEur} onChange={(e) => setPriceEur(e.target.value)} />
        </div>
        <div>
          <label className="input-label">{t("studio.f.credits")}</label>
          <input className="input" type="number" min={0} max={500} step={5} value={credits} onChange={(e) => setCredits(e.target.value)} />
        </div>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>{t("studio.f.credits_hint")}</span>

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

      <div className="panel" style={{ padding: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>🎬 {t("studio.f.video")}</span>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
          {t("studio.f.video_none")} ({t("studio.f.thumbnail")}: Day 4 upload pipeline)
        </p>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" disabled={busy || title.trim().length < 3} onClick={submit}>
          {busy ? "…" : existing ? t("studio.save") : t("studio.create")}
        </button>
        <button className="btn" onClick={onDone}>{t("studio.cancel")}</button>
      </div>
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
        {t("studio.revenue.note")}
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

function Revenue() {
  const { t } = useT();
  const { sessionToken } = useAuth();
  const data = useQuery(api.studioWire.getRevenue, sessionToken ? { sessionToken } : "skip");
  const [amount, setAmount] = useState("10.00");
  const preview = useQuery(
    api.studioWire.previewSplit,
    sessionToken ? { sessionToken, amountCents: Math.round(parseFloat(amount || "0") * 100) } : "skip"
  );
  const ok = data && "ok" in data && data.ok;
  const money = (c: number) => `€${(c / 100).toFixed(2)}`;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatCard icon={ok ? `(${data.sharePct}%)` : "…"} value={ok ? money(data.accruingCents) : "—"} label={t("studio.revenue.accruing")} accent />
        <StatCard icon="🏦" value={ok ? money(data.scheduledCents) : "—"} label={t("studio.revenue.scheduled")} />
        <StatCard icon="✅" value={ok ? money(data.paidCents) : "—"} label={t("studio.revenue.paid")} />
      </div>

      {ok && data.payouts.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {data.payouts.map((p) => (
            <div key={p.id} className="panel" style={{ padding: 12, display: "flex", justifyContent: "space-between" }}>
              <span>{new Date(p.periodStart).toLocaleDateString()} – {new Date(p.periodEnd).toLocaleDateString()}</span>
              <strong style={{ fontFamily: "Sora" }}>{money(p.amountCents)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>{t("studio.revenue.empty")}</p>
      )}

      <div className="panel" style={{ padding: 14, display: "grid", gap: 8 }}>
        <strong style={{ fontFamily: "Sora" }}>{t("studio.revenue.preview")}</strong>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input className="input" style={{ maxWidth: 140 }} type="number" min={0} step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span className="muted" style={{ fontSize: 13 }}>
            {preview && "ok" in preview && preview.ok
              ? `${t("studio.revenue.share")}: ${preview.sharePct}% → ${money(preview.teacherCents)} / ${money(preview.platformCents)}`
              : "…"}
          </span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>{t("studio.revenue.note")}</p>
      </div>
    </div>
  );
}
