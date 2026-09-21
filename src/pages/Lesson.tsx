import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Empty, LevelBadge, Page } from "../components/ui";
import { IcCheck, IcPause, IcPlay } from "../components/icons";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { courseById, userById } from "../data/store";

type Phase = "watch" | "learn" | "practice" | "done";

export default function Lesson() {
  const { courseId, lessonId } = useParams();
  const nav = useNavigate();
  const { t, isLessonDone, completeLesson, touchLesson, toast } = useStore();
  const auth = useAuth();
  const course = courseId ? courseById(courseId) : undefined;
  const lesson = course?.lessons.find((l) => l.id === lessonId);

  // Day 7 — real server progress: phase engagement and completion persist
  // through Convex for signed-in dancers. Guests keep the local preview.
  const touchLive = useMutation(api.learningWire.touchLesson);
  const completeLive = useMutation(api.learningWire.completeLesson);
  const [serverXp, setServerXp] = useState<number | null>(null);

  const [phase, setPhase] = useState<Phase>("watch");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [loop, setLoop] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setPhase("watch");
    if (course && lesson) {
      touchLesson(course.id, lesson.id);
      if (auth.sessionToken) {
        void touchLive({ sessionToken: auth.sessionToken, lessonKey: lesson.id, courseKey: course.id, phase: "watch" }).catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = speed;
  }, [speed, playing, phase]);

  if (!course || !lesson) return <Page><Empty icon="🔍" text="Lesson not found" /></Page>;

  const idx = course.lessons.findIndex((l) => l.id === lesson.id);
  const next = course.lessons[idx + 1];
  const done = isLessonDone(lesson.id);

  const phases: { id: Phase; label: string; icon: string }[] = [
    { id: "watch", label: t("lesson.watch"), icon: "👀" },
    { id: "learn", label: t("lesson.learn"), icon: "🧠" },
    { id: "practice", label: t("lesson.practice"), icon: "🎯" },
    { id: "done", label: t("lesson.complete"), icon: "🏁" },
  ];

  const phaseHint: Record<Phase, string> = {
    watch: t("lesson.description"),
    learn: t("lesson.moves"),
    practice: t("lesson.practiceTip"),
    done: t("lesson.congrats"),
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
    setPlaying(!v.paused);
  };

  return (
    <Page>
      <button onClick={() => nav(`/course/${course.id}`)} className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }}>
        ← {t("lesson.backToCourse")}
      </button>

      {/* stage */}
      <div className="video-stage">
        <video
          ref={videoRef}
          src={lesson.video}
          poster={course.cover}
          autoPlay
          muted
          loop={loop}
          playsInline
          style={{ transform: mirror ? "scaleX(-1)" : undefined }}
        />
        <button
          onClick={togglePlay}
          style={{ position: "absolute", inset: 0, background: "transparent", border: "none", cursor: "pointer" }}
          aria-label="toggle play"
        />
        {!playing && (
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(227,179,65,0.92)", color: "#171204", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <IcPlay size={26} />
            </span>
          </span>
        )}
        <span className="chip" style={{ position: "absolute", top: 12, left: 12, background: "rgba(10,12,16,0.75)", fontSize: 11, padding: "4px 10px" }}>
          {phase === "watch" ? "👀" : phase === "learn" ? "🧠" : phase === "practice" ? "🎯" : "🏁"} {t(phases.find((p) => p.id === phase)!.label as never)}
        </span>
        <span className="chip" style={{ position: "absolute", top: 12, right: 12, background: "rgba(10,12,16,0.75)", fontSize: 11, padding: "4px 10px" }}>
          {lesson.dur} {t("common.min")}
        </span>
      </div>

      {/* controls */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0 4px", flexWrap: "wrap", alignItems: "center" }}>
        <button className={`chip${speed === 0.75 ? " active" : ""}`} onClick={() => setSpeed(speed === 1 ? 0.75 : speed === 0.75 ? 0.5 : 1)}>
          {t("lesson.speed")} {speed}×
        </button>
        <button className={`chip${mirror ? " active" : ""}`} onClick={() => setMirror(!mirror)}>
          🪞 {t("lesson.mirror")}
        </button>
        <button className={`chip${loop ? " active" : ""}`} onClick={() => setLoop(!loop)}>
          🔁 {t("lesson.loop")}
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={togglePlay}>
          {playing ? <IcPause size={15} /> : <IcPlay size={15} />} {playing ? "Pause" : t("lesson.watch")}
        </button>
      </div>

      {/* phase stepper */}
      <div className="seg gold" style={{ width: "100%", margin: "14px 0 18px", display: "flex", overflowX: "auto" }}>
        {phases.map((p) => (
          <button
            key={p.id}
            className={phase === p.id ? "active" : ""}
            onClick={() => setPhase(p.id)}
            style={{ flex: 1, whiteSpace: "nowrap" }}
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>

      {/* phase content */}
      <div className="panel" style={{ padding: 18, marginBottom: 20 }}>
        {phase === "watch" && (
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>{lesson.title}</h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.65, fontSize: 14.5 }}>{lesson.desc}</p>
          </div>
        )}

        {phase === "learn" && (
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 14 }}>{t("lesson.moves")}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {lesson.moves.map((m, i) => (
                <div key={i} style={{ display: "flex", gap: 12 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--gold-soft)", color: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name} <span className="faint" style={{ fontWeight: 600 }}>· {m.timing}</span></div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>💡 {m.tip}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === "practice" && (
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 10 }}>🎯 {t("lesson.practice")}</h2>
            <p className="muted" style={{ lineHeight: 1.65, fontSize: 14.5, margin: "0 0 14px" }}>{t("lesson.practiceTip")}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className={`chip${speed === 0.75 ? " active" : ""}`} onClick={() => { setSpeed(0.75); setMirror(true); setLoop(true); }}>
                🐢 0.75× + {t("lesson.mirror")} + {t("lesson.loop")}
              </button>
              <button className="chip" onClick={() => { setSpeed(1); setMirror(false); setLoop(false); }}>
                ⚡ 1×
              </button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>{done ? "🏅" : "🎉"}</div>
            <h2 style={{ fontSize: 19, marginBottom: 6 }}>{t("lesson.congrats")}</h2>
            <p className="muted" style={{ margin: "0 0 16px", fontSize: 14 }}>{t("lesson.congratsSub")}</p>
            {!done && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  completeLesson(course.id, lesson.id);
                  // Day 7 — persist completion server-side; XP comes from the
                  // server decision (first completion pays, repeats never do).
                  if (auth.sessionToken) {
                    void completeLive({
                      sessionToken: auth.sessionToken,
                      lessonKey: lesson.id,
                      courseKey: course.id,
                    })
                      .then((res) => {
                        if (res.ok && res.xpGranted > 0) setServerXp(res.xpGranted);
                      })
                      .catch(() => undefined);
                  }
                  toast("+150 XP");
                }}
              >
                <IcCheck size={17} /> {t("lesson.markComplete")}
              </button>
            )}
            {done && (
              <span className="chip active">
                ✓ {t("lesson.completed")} · {serverXp !== null && serverXp === 0 ? t("lesson.xpAlready") : "+150 XP"}
              </span>
            )}
          </div>
        )}
      </div>

      <p className="faint" style={{ fontSize: 12.5, margin: "0 0 20px", textAlign: "center" }}>
        💡 {phaseHint[phase]}
      </p>

      {/* meta + up next */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <LevelBadge level={course.level} />
        <span className="chip" style={{ fontSize: 11.5, padding: "4px 11px" }}>{course.style}</span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {userById(course.teacherId).name}
        </span>
      </div>

      {next && (
        <section>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>{t("lesson.upNext")}</h2>
          <button
            onClick={() => nav(`/lesson/${course.id}/${next.id}`)}
            className="panel panel-hover"
            style={{ display: "flex", gap: 13, padding: 12, alignItems: "center", width: "100%", cursor: "pointer", textAlign: "left", color: "inherit" }}
          >
            <div style={{ position: "relative", width: 118, aspectRatio: "16/10", borderRadius: 11, overflow: "hidden", flexShrink: 0 }}>
              <img src={course.cover} alt="" className="media-cover" />
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}>
                <IcPlay size={24} />
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{next.title}</div>
              <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>{next.dur} {t("common.min")}</div>
            </div>
          </button>
        </section>
      )}
    </Page>
  );
}
