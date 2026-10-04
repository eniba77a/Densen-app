/**
 * DENSEN — Practice Player (Day 23).
 * ==================================
 * The slow-motion dance lesson player. REAL controls only — every button
 * below performs its advertised action:
 *
 *  • Speeds 0.25× / 0.5× / 0.75× / 1× — applied live (no restart), shown as
 *    the active chip, with audio pitch preserved where the browser supports
 *    it (preservesPitch + webkit prefix) and graceful fallback where not.
 *  • Play / pause / replay / ±10s seek / scrubbing / fullscreen / volume.
 *  • Practice Mode: A–B section repeat with markers on the timeline, replay
 *    of the section, and "return to section start".
 *  • Teacher timestamps: tapping a step seeks the video to that moment.
 *
 * The chosen speed is remembered PER LESSON (src/lib/practicePlayer.ts) so a
 * practice session never unexpectedly slows other videos in the feed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import {
  PLAYBACK_SPEEDS,
  clampSpeed,
  emptyAB,
  formatTime,
  loadLessonSpeed,
  reduceAB,
  saveLessonSpeed,
  sectionStart,
  shouldLoopToA,
  type ABMarkers,
  type PlaybackSpeed,
} from "../lib/practicePlayer";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SPEED_LABEL_KEY: Record<PlaybackSpeed, string> = {
  0.25: "player.verySlow",
  0.5: "player.slow",
  0.75: "player.slightlySlow",
  1: "player.normal",
};

export interface PlayerStep {
  name: string;
  timing: string;
  tip?: string;
  atSec?: number;
}

interface PracticePlayerProps {
  src: string;
  poster?: string;
  /** Per-lesson speed memory key (the lesson id). */
  lessonKey: string;
  /** Teacher movement timestamps — seekable when atSec is present. */
  steps?: PlayerStep[];
  autoPlay?: boolean;
  mirror?: boolean;
  loopAll?: boolean;
}

export default function PracticePlayer({ src, poster, lessonKey, steps = [], autoPlay = false, mirror = false, loopAll = false }: PracticePlayerProps) {
  const { t } = useStore();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const prevTimeRef = useRef(0);
  const draggingRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(autoPlay); // autoplay starts muted (browser policy)
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [markers, setMarkers] = useState<ABMarkers>({ ...emptyAB });
  const [pitchSupported, setPitchSupported] = useState(true);

  // Load this lesson's remembered practice speed once per lesson.
  useEffect(() => {
    setSpeed(loadLessonSpeed(lessonKey));
    setMarkers({ ...emptyAB });
    prevTimeRef.current = 0;
    setCurrent(0);
  }, [lessonKey]);

  // Speed applies live — changing it never restarts playback.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    saveLessonSpeed(lessonKey, speed);
  }, [speed, lessonKey]);

  // Pitch preservation, where the browser supports it (graceful otherwise).
  useEffect(() => {
    const v = videoRef.current as any;
    if (!v) return;
    let supported = false;
    if ("preservesPitch" in v) {
      v.preservesPitch = true;
      supported = true;
    }
    if ("webkitPreservesPitch" in v) {
      v.webkitPreservesPitch = true;
      supported = true;
    }
    if ("mozPreservesPitch" in v) {
      v.mozPreservesPitch = true;
      supported = true;
    }
    setPitchSupported(supported);
  }, []);

  // Mirror / whole-video loop props.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.style.transform = mirror ? "scaleX(-1)" : "";
  }, [mirror]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.loop = loopAll && markers.a === null && markers.b === null;
  }, [loopAll, markers]);

  // Element state → React state (single source of truth stays the element).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      const now = v.currentTime;
      // A–B section repeat: jump back to A the moment the playhead passes B.
      if (shouldLoopToA(markers, now, prevTimeRef.current)) {
        v.currentTime = sectionStart(markers);
        prevTimeRef.current = sectionStart(markers);
        setCurrent(sectionStart(markers));
        return;
      }
      prevTimeRef.current = now;
      if (!draggingRef.current) setCurrent(now);
    };
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const onEnded = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
      v.removeEventListener("ended", onEnded);
      // Resource cleanup: stop decode + release the element's work.
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch {
        /* element already gone */
      }
    };
    // markers is intentionally in deps: the A–B loop must track live markers.
  }, [markers, src]);

  // Fullscreen state tracking.
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Pause when the tab hides (media resource hygiene).
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) videoRef.current?.pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  }, []);

  const replay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => setPlaying(false));
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration || v.currentTime);
    setCurrent(v.currentTime);
  }, []);

  const seekTo = useCallback((at: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, at), v.duration || at);
    setCurrent(v.currentTime);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void stage.requestFullscreen?.().catch(() => undefined);
  }, []);

  const applyVolume = useCallback((val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
    setVolume(val);
    setMuted(val === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
    if (!next && v.volume === 0) {
      v.volume = 1;
      setVolume(1);
    }
  }, []);

  const inSection = markers.a !== null && markers.b !== null;

  return (
    <div>
      {/* stage — the fullscreen target */}
      <div ref={stageRef} className="video-stage" style={{ background: "#000" }}>
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          autoPlay={autoPlay}
          muted={muted}
          playsInline
          preload="metadata"
          aria-label={`${t("lesson.practice")} · ${speed}×`}
        />
        <button onClick={togglePlay} style={{ position: "absolute", inset: 0, background: "transparent", border: "none", cursor: "pointer" }} aria-label={playing ? t("player.pause") : t("player.play")}>
          <span style={{ position: "absolute", top: 10, left: 10, background: "rgba(10,12,16,0.78)", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 800, color: "var(--gold)", pointerEvents: "none" }}>
            {speed}× · {t(SPEED_LABEL_KEY[speed] as never)}
          </span>
        </button>
        {!playing && (
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(227,179,65,0.92)", color: "#171204", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>▶</span>
          </span>
        )}
        {inSection && (
          <span style={{ position: "absolute", top: 10, right: 10, background: "rgba(227,179,65,0.92)", color: "#171204", borderRadius: 999, padding: "4px 10px", fontSize: 11.5, fontWeight: 800, pointerEvents: "none" }}>
            🔁 A–B
          </span>
        )}
      </div>

      {/* timeline with A/B markers */}
      <div style={{ margin: "10px 0 2px", position: "relative" }}>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.05}
          value={Math.min(current, duration || 0)}
          aria-label={t("player.timeline")}
          style={{ width: "100%", accentColor: "var(--gold)" }}
          onPointerDown={() => (draggingRef.current = true)}
          onPointerUp={() => (draggingRef.current = false)}
          onPointerCancel={() => (draggingRef.current = false)}
          onKeyDown={() => (draggingRef.current = true)}
          onKeyUp={() => (draggingRef.current = false)}
          onInput={(e) => seekTo(Number((e.target as HTMLInputElement).value))}
        />
        {inSection && duration > 0 && (
          <>
            <span aria-hidden="true" style={{ position: "absolute", left: `${(markers.a! / duration) * 100}%`, top: -4, width: 3, height: 14, borderRadius: 2, background: "var(--gold)" }} />
            <span aria-hidden="true" style={{ position: "absolute", left: `${(markers.b! / duration) * 100}%`, top: -4, width: 3, height: 14, borderRadius: 2, background: "var(--gold)" }} />
          </>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--ink-faint)", fontVariantNumeric: "tabular-nums" }}>
          <span>{formatTime(current)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* main controls — every control does exactly what it says */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0 4px" }}>
        <button className="btn btn-sm" onClick={togglePlay} aria-label={playing ? t("player.pause") : t("player.play")}>
          {playing ? "⏸" : "▶"} {playing ? t("player.pause") : t("player.play")}
        </button>
        <button className="btn btn-sm" onClick={replay} aria-label={t("player.replay")}>⟲ {t("player.replay")}</button>
        <button className="btn btn-sm" onClick={() => seekBy(-10)} aria-label={t("player.back10")}>⏪ 10s</button>
        <button className="btn btn-sm" onClick={() => seekBy(10)} aria-label={t("player.fwd10")}>10s ⏩</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={toggleMute} aria-label={muted ? t("player.unmute") : t("player.mute")}>
          {muted ? "🔇" : "🔊"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label={t("player.volume")}
          style={{ width: 84, accentColor: "var(--gold)" }}
          onInput={(e) => applyVolume(Number((e.target as HTMLInputElement).value))}
        />
        <button className="btn btn-sm" onClick={toggleFullscreen} aria-label={fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}>
          {fullscreen ? "⛶" : "⛶"} {fullscreen ? t("player.exitFullscreen") : t("player.fullscreen")}
        </button>
      </div>

      {/* speed selector — the slow-motion core */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "10px 0 2px" }}>
        <span className="faint" style={{ fontSize: 12, fontWeight: 700 }}>🐢 {t("player.speed")}:</span>
        {PLAYBACK_SPEEDS.map((s) => (
          <button
            key={s}
            className={`chip ${speed === s ? "active" : ""}`}
            aria-pressed={speed === s}
            onClick={() => setSpeed(clampSpeed(s))}
          >
            {s}× · {t(SPEED_LABEL_KEY[s] as never)}
          </button>
        ))}
        {!pitchSupported && (
          <span className="faint" style={{ fontSize: 11 }}>· {t("player.pitchFallback")}</span>
        )}
      </div>

      {/* Practice Mode — A–B repeat + teacher timestamps */}
      <div className="panel" style={{ padding: 13, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13.5 }}>🎯 {t("player.practice")}</strong>
          {inSection && (
            <span className="faint" style={{ fontSize: 11.5 }}>
              A {formatTime(markers.a)} → B {formatTime(markers.b)}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
          <button
            className={`chip ${markers.a !== null ? "active" : ""}`}
            onClick={() => {
              const at = videoRef.current?.currentTime ?? 0;
              setMarkers((m) => reduceAB(m, { type: "setA", at }));
              seekTo(at);
            }}
          >
            Ⓐ {t("player.setA")} {markers.a !== null ? `(${formatTime(markers.a)})` : ""}
          </button>
          <button
            className={`chip ${markers.b !== null ? "active" : ""}`}
            onClick={() => {
              const at = videoRef.current?.currentTime ?? 0;
              setMarkers((m) => reduceAB(m, { type: "setB", at }));
            }}
          >
            Ⓑ {t("player.setB")} {markers.b !== null ? `(${formatTime(markers.b)})` : ""}
          </button>
          <button
            className="chip"
            disabled={!inSection}
            style={{ opacity: inSection ? 1 : 0.5 }}
            onClick={() => {
              if (!inSection) return;
              seekTo(sectionStart(markers));
              void videoRef.current?.play().catch(() => undefined);
            }}
          >
            ▶️ {t("player.replaySection")}
          </button>
          <button
            className="chip"
            disabled={markers.a === null}
            style={{ opacity: markers.a !== null ? 1 : 0.5 }}
            onClick={() => inSection && seekTo(sectionStart(markers))}
          >
            ⏮ {t("player.sectionStart")}
          </button>
          <button
            className="chip"
            disabled={markers.a === null && markers.b === null}
            style={{ opacity: markers.a !== null || markers.b !== null ? 1 : 0.5 }}
            onClick={() => setMarkers({ ...emptyAB })}
          >
            ✕ {t("player.clear")}
          </button>
        </div>

        {steps.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <span className="faint" style={{ fontSize: 12, fontWeight: 700 }}>📑 {t("player.timestamps")}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {steps.map((s, i) =>
                s.atSec !== undefined ? (
                  <button key={i} className="chip" onClick={() => seekTo(s.atSec!)} title={s.tip || s.name}>
                    <span style={{ color: "var(--gold)", fontWeight: 800 }}>{formatTime(s.atSec)}</span> {s.name}
                  </button>
                ) : (
                  <span key={i} className="chip" style={{ opacity: 0.75 }} title={s.tip || s.name}>
                    {s.timing ? `${s.timing} · ` : ""}{s.name}
                  </span>
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
