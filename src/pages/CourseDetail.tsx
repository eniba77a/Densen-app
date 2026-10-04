import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, Bar, LevelBadge } from "../components/ui";
import { IcCheck, IcPlay, IcVerified } from "../components/icons";
import { useStore } from "../state/store";
import { useGov } from "../state/governance";
import { useAuth } from "../state/auth";
import { courseById, fmt, userById } from "../data/store";
import { useCatalogCourse } from "../data/useCatalogCourse";
import { courseMinutes, whatYouLearn } from "../data/learning";
import { Empty, Page } from "../components/ui";
import { StatusPill } from "../components/gov-ui";
import { averageRating, reviewsFor } from "../data/governance";

export default function CourseDetail() {
  const { courseId } = useParams();
  const savePractice = useMutation(api.practiceWire.saveItem);
  const nav = useNavigate();
  const { t, lang, isLessonDone, following, toggleFollow, saved, toggleSave, toast } = useStore();
  const auth = useAuth();
  // Day 8 — resolve seed catalog ids instantly; Studio-published ids resolve
  // through the live public catalog (reactive, guest-browsable).
  const catalogItem = useCatalogCourse(courseId);
  const c = catalogItem?.course ?? (courseId ? courseById(courseId) : undefined);
  const [playing, setPlaying] = useState(false);
  // Day 23 — Densen is a FREE platform: every published lesson plays without
  // payment or credits. The purchase/credit-unlock flows were removed.

  // Day 7 — live server progress: completion status and the % bar are a
  // reactive Convex subscription, so a completed lesson updates here and on
  // Progress instantly, no refresh. Local store state remains the signed-out
  // preview source.
  const serverProgress = useQuery(
    api.learningWire.getCourseProgress,
    auth.sessionToken && c
      ? { sessionToken: auth.sessionToken, courseKey: c.id, lessonKeys: c.lessons.map((l) => l.id) }
      : "skip"
  );
  const serverLive = Boolean(
    serverProgress && typeof serverProgress === "object" && "ok" in serverProgress && serverProgress.ok
  );
  const doneSet: Set<string> = serverLive
    ? new Set((serverProgress as { completed: string[] }).completed)
    : new Set();
  const isDone = (lessonId: string) => (serverLive ? doneSet.has(lessonId) : isLessonDone(lessonId));
  const pct = c
    ? serverLive
      ? (serverProgress as { pct: number }).pct
      : Math.round((c.lessons.filter((l) => isLessonDone(l.id)).length / c.lessons.length) * 100)
    : 0;

  if (!c) return <Page><Empty icon="🔍" text="Course not found" /></Page>;

  // Seed rows resolve their teacher from the store; Studio-published rows
  // carry the server's public teacher projection.
  const teacher = catalogItem?.teacher ?? userById(c.teacherId);
  const isFollowing = following.has(teacher.id);
  const isSaved = saved.has(c.id);
  const nextLesson = c.lessons.find((l) => !isDone(l.id)) ?? c.lessons[0];
  const reviews = reviewsFor(c.id);
  const avg = averageRating(c.id);
  const minutes = courseMinutes(c);
  const outcomes = whatYouLearn(c);
  const courseComplete = pct === 100;

  return (
    <Page>
      <button onClick={() => nav(-1)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {t("common.back")}
      </button>

      {/* trailer */}
      <div className="video-stage" style={{ marginBottom: 18 }}>
        {playing ? (
          <video src={c.trailer} poster={c.cover} autoPlay controls loop muted aria-label={`Trailer: ${c.title}, ${c.style} course by ${teacher.name}`} />
        ) : (
          <>
            <img src={c.cover} alt={`Dancer performing ${c.style.toLowerCase()} choreography — cover of the course ${c.title} by ${teacher.name}`} className="media-cover" />
            <button
              onClick={() => setPlaying(true)}
              aria-label={`${t("common.watchTrailer")}: ${c.title}`}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.3)",
                border: "none",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 74,
                  height: 74,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #f0c75e, var(--gold) 55%, #cf9a35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#171204",
                  boxShadow: "0 10px 34px rgba(227,179,65,0.45)",
                  transition: "transform 0.2s ease",
                }}
              >
                <IcPlay size={30} />
              </span>
            </button>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <LevelBadge level={c.level} />
        <span className="chip" style={{ fontSize: 11.5, padding: "4px 11px" }}>{c.style}</span>
        {/* Day 23 — every lesson is FREE: one honest chip, no price ladder */}
        <span
          className="chip"
          style={{
            fontSize: 11.5,
            padding: "4px 11px",
            fontWeight: 800,
            color: "var(--gold)",
            borderColor: "var(--gold-line)",
          }}
        >
          {`✦ ${t("learn.access.free")}`}
        </span>
        {avg !== null ? (
          <span className="faint" style={{ fontSize: 12.5 }}>★ {avg} · {fmt(c.enrolled)} {t("learn.enrolled")}</span>
        ) : (
          <span className="faint" style={{ fontSize: 12.5 }}>{fmt(c.enrolled)} {t("learn.enrolled")} · No reviews yet</span>
        )}
      </div>

      <h1 style={{ fontSize: 25, fontWeight: 800, marginBottom: 14 }}>{c.title}</h1>

      {/* teacher */}
      <div className="panel" style={{ padding: 14, display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <Avatar src={teacher.avatar} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}>
            {teacher.name} {teacher.verified && <IcVerified />}
          </div>
          <div className="muted" style={{ fontSize: 12.5 }}>{t("learn.teacher")} · @{teacher.username}</div>
        </div>
        <button className={`btn btn-sm ${isFollowing ? "" : "btn-primary"}`} onClick={() => toggleFollow(teacher.id)}>
          {isFollowing ? t("common.following") : t("common.follow")}
        </button>
      </div>

      {/* CTA */}
      <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ flex: 1, minWidth: 200 }} onClick={() => nav(`/lesson/${c.id}/${nextLesson.id}`)}>
          {pct > 0 ? t("learn.continueCourse") : t("learn.startCourse")} <IcPlay size={15} />
        </button>
        <button
          className="btn"
          onClick={() => {
            toggleSave(c.id);
            // Day 12 — the bookmark also creates the real MY PRACTICE item
            // (idempotent per contentRef) with the class step plan.
            if (auth.sessionToken && !isSaved) {
              void savePractice({
                sessionToken: auth.sessionToken,
                kind: "class",
                title: c.title,
                style: c.style,
                difficulty: c.level,
                contentRef: c.id,
                href: `/course/${c.id}`,
              });
              toast(`${t("practice.loggedPractice")} 🎯`);
            }
          }}
        >
          {isSaved ? "🔖" : "📑"} {isSaved ? t("common.saved") : t("common.save")}
        </button>
      </div>

      {/* Day 23 — FREE, forever: every lesson plays without payment or credits. */}
      <div className="panel" style={{ padding: 16, marginBottom: 22, borderColor: "rgba(74,222,128,0.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status="pass" label={t("learn.access.free")} />
          <span className="faint" style={{ fontSize: 12.5 }}>{t("learn.freeForever")}</span>
        </div>
      </div>

      {/* Day 7 — completion status: live from the server progress rows */}
      {courseComplete && (
        <div className="panel" style={{ padding: 14, marginBottom: 22, borderColor: "rgba(74,222,128,0.35)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status="pass" label={t("learn.courseComplete")} />
          <span className="faint" style={{ fontSize: 12.5 }}>{t("learn.certNote")}</span>
        </div>
      )}

      {/* Day 7 — what you learn, derived from the course's own lessons */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>{t("learn.whatYouLearn")}</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {outcomes.map((o) => (
            <div key={o} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ color: "var(--gold)", fontWeight: 800, flexShrink: 0 }}>✓</span>
              <span className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{o}</span>
            </div>
          ))}
        </div>
      </section>

      {pct > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            <span>{t("learn.inProgress")}</span>
            <span className="gold-text">{pct}%</span>
          </div>
          <Bar pct={pct} lg />
        </div>
      )}

      {/* about */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>{t("learn.about")}</h2>
        <p className="muted" style={{ margin: 0, lineHeight: 1.65, fontSize: 14.5 }}>{c.about}</p>
      </section>

      {/* curriculum — checkmarks live from server progress (Day 7) */}
      <section>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>
          {t("learn.curriculum")} · {c.lessons.length} {t("learn.lessons")} · {minutes} {t("common.min")}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {c.lessons.map((l, i) => {
            const done = isDone(l.id);
            return (
              <button
                key={l.id}
                onClick={() => nav(`/lesson/${c.id}/${l.id}`)}
                className="panel panel-hover"
                style={{ display: "flex", alignItems: "center", gap: 13, padding: 13, cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
              >
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: done ? "var(--gold-soft)" : "rgba(255,255,255,0.06)",
                    color: done ? "var(--gold)" : "var(--ink-dim)",
                    fontSize: 15,
                    fontWeight: 800,
                  }}
                >
                  {done ? <IcCheck size={18} /> : i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{l.title}</div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{l.dur} {t("common.min")}</div>
                </div>
                <IcPlay size={16} />
              </button>
            );
          })}
        </div>
      </section>

      {/* authentic reviews only — no seeded ratings for courses without UGC */}
      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>💬 {lang === "sq" ? "Vlerësime" : "Reviews"} {avg !== null && <span className="faint" style={{ fontSize: 13 }}>· ★ {avg} · {reviews.length}</span>}</h2>
        {reviews.length === 0 ? (
          <p className="faint" style={{ fontSize: 13.5 }}>No reviews yet{lang === "sq" ? " — akoma pa vlerësime" : ""}. Only dancers who took this class can review it.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {reviews.map((r) => {
              const ru = userById(r.userId);
              return (
                <div key={r.id} className="panel" style={{ padding: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <Avatar src={ru.avatar} size={30} />
                    <strong style={{ fontSize: 13 }}>@{ru.username}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>★ {r.rating}</span>
                    <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>{r.ts}</span>
                  </div>
                  <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.6 }}>{r.text}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* review composer — genuine UGC only, one per dancer */}
      <ReviewComposer courseId={c.id} />
    </Page>
  );
}

function ReviewComposer({ courseId }: { courseId: string }) {
  const { t } = useStore();
  const { addReview, reviews, toast } = useGov();
  const already = reviews.some((r: { courseId: string }) => r.courseId === courseId);
  const [rating, setRating] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);
  const [text, setText] = useState("");
  if (already) return null;
  return (
    <section style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 15, marginBottom: 10 }}>✍️ {t("common.comment")}</h2>
      <div className="panel" style={{ padding: 14 }}>
        <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={rating === n}
              onClick={() => setRating(n)}
              style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: rating >= n ? "var(--gold)" : "var(--ink-faint)", padding: 2 }}
            >
              ★<span style={{ fontSize: 11, marginLeft: 2 }}>{n}</span>
            </button>
          ))}
        </div>
        <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("gov.report.details")} aria-label={t("common.comment")} />
        <button
          className="btn btn-primary btn-sm"
          style={{ marginTop: 10 }}
          disabled={!rating || !text.trim()}
          onClick={() => {
            if (rating !== 0) addReview(courseId, rating, text.trim());
            toast("Review posted ✓");
          }}
        >
          {t("messages.send")}
        </button>
      </div>
    </section>
  );
}
