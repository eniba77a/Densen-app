import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Bar } from "../components/ui";
import { IcPlay } from "../components/icons";
import { useStore } from "../state/store";
import { courseById, courses } from "../data/store";
import { mergeCatalog } from "../data/serverCatalog";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_META,
  FREE_TRACK,
  LEARN_CATEGORIES,
  courseMinutes,
  type ContentType,
} from "../data/learning";
import type { TKey } from "../i18n";

const LEVELS = ["All", "Beginner", "Intermediate", "Advanced", "Kids"] as const;

/**
 * Day 7 — DENSEN LEARN.
 * Full category set (Beginner…Professional), content-type filter
 * (MOVE/COMBO/CHOREOGRAPHY/CLASS/COURSE/LESSON), the START DANCING — FREE
 * beginner path, and honest live progress bars from the shared store.
 * Day 8 — teacher publications merge in live from the server catalog:
 * a verified teacher publishing in the Studio appears here reactively.
 */
export default function Learn() {
  const { t, courseProgress } = useStore();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const cat = params.get("cat") ?? "All";
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("All");
  const [ctype, setCtype] = useState<"all" | ContentType>("all");

  // Day 8 — public catalog bridge: published studio classes + courses.
  const serverRows = useQuery(api.catalog.listPublishedAll, {});
  const catalog = useMemo(() => mergeCatalog(courses, serverRows), [serverRows]);

  const list = useMemo(
    () =>
      catalog.filter((c) => {
        if (cat === "Beginner" && c.level !== "Beginner") return false;
        if (cat === "Advanced" && c.level !== "Advanced") return false;
        if (cat === "Professional" && c.level !== "Advanced") return false;
        if (cat === "Kids" && c.level !== "Kids") return false;
        if (cat === "Teens" && c.level !== "Intermediate") return false;
        if (
          cat !== "All" &&
          cat !== "Beginner" &&
          cat !== "Advanced" &&
          cat !== "Professional" &&
          cat !== "Kids" &&
          cat !== "Teens" &&
          c.style !== cat
        )
          return false;
        if (level !== "All" && c.level !== level) return false;
        if (ctype !== "all") {
          // Content-type filter: every catalog course is built from lessons
          // that teach moves/combos/choreography — a filter matches when the
          // course contains that type of material.
          const materialByType: Record<Exclude<ContentType, "class" | "course" | "lesson">, boolean> = {
            move: true,
            combo: true,
            choreography: c.lessons.some((l) => l.moves.length >= 2),
          };
          const matches: Record<"all" | ContentType, boolean> = {
            all: true,
            move: materialByType.move,
            combo: materialByType.combo,
            choreography: materialByType.choreography,
            class: true,
            course: true,
            lesson: true,
          };
          if (!matches[ctype]) return false;
        }
        const needle = q.trim().toLowerCase();
        return (
          needle === "" ||
          c.title.toLowerCase().includes(needle) ||
          c.style.toLowerCase().includes(needle)
        );
      }),
    [cat, level, q, ctype, catalog]
  );

  const catLabel = (id: string): string =>
    id === "All" ? t("learn.all") : t(`learn.cat.${id}` as TKey);

  return (
    <div className="anim-fade" style={{ maxWidth: 1160, margin: "0 auto", padding: "22px 16px 110px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>{t("learn.title")}</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>{t("learn.subtitle")}</p>
      </div>

      {/* START DANCING — FREE */}
      <section
        className="panel"
        style={{ padding: 18, marginBottom: 24, borderColor: "var(--gold-line)", background: "linear-gradient(160deg, rgba(227,179,65,0.07), transparent 60%)" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
          <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>
            <span className="gold-text">✦</span> {t("learn.startFree")}
          </h2>
          <span className="chip" style={{ fontSize: 11, padding: "3px 10px", color: "var(--gold)", borderColor: "var(--gold-line)" }}>
            {t("learn.access.free")}
          </span>
        </div>
        <p className="muted" style={{ margin: "0 0 14px", fontSize: 13.5 }}>{t("learn.startFreeSub")}</p>

        <div className="no-scrollbar" style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {FREE_TRACK.map((step, i) => {
            const course = courseById(step.courseId);
            const pct = course ? courseProgress(course.id) : 0;
            return (
              <button
                key={step.id}
                onClick={() => nav(`/course/${step.courseId}`)}
                className="panel panel-hover"
                style={{ flex: "0 0 168px", textAlign: "left", padding: 0, overflow: "hidden", cursor: "pointer", color: "inherit" }}
              >
                <div style={{ position: "relative", aspectRatio: "16/10", background: "var(--panel-2)" }}>
                  {course && <img src={course.cover} alt="" className="media-cover" loading="lazy" />}
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(0,0,0,0.35)",
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: "rgba(227,179,65,0.92)",
                        color: "#171204",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <IcPlay size={18} />
                    </span>
                  </span>
                  <span style={{ position: "absolute", top: 8, left: 8, fontSize: 10, fontWeight: 800, background: "rgba(10,12,16,0.8)", padding: "3px 8px", borderRadius: 999 }}>
                    {i + 1}/{FREE_TRACK.length}
                  </span>
                </div>
                <div style={{ padding: "10px 12px 12px" }}>
                  <div className="faint" style={{ fontSize: 10.5, marginBottom: 3 }}>
                    {CONTENT_TYPE_META[step.contentType].icon} {t(`learn.ct.${step.contentType}` as TKey)} · {step.minutes} {t("common.min")}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.3 }}>{t(step.labelKey as TKey)}</div>
                  {pct > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <Bar pct={pct} />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Arcade Mode — a feature inside Learn, not a permanent tab (Day 22) */}
      <button
        onClick={() => nav("/arcade")}
        className="panel panel-hover"
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          gap: 14,
          textAlign: "left",
          padding: "14px 16px",
          marginBottom: 24,
          cursor: "pointer",
          color: "inherit",
          borderColor: "var(--gold-line)",
          background: "linear-gradient(120deg, rgba(227,179,65,0.10), transparent 55%), var(--panel)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            background: "linear-gradient(135deg, #f0c75e, var(--gold) 55%, var(--gold-deep))",
            color: "var(--gold-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 21,
            flexShrink: 0,
          }}
        >
          🕹
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 800, fontSize: 15 }}>{t("arcade.title")}</span>
          <span className="muted" style={{ display: "block", fontSize: 12.5, marginTop: 2 }}>{t("arcade.subtitle")}</span>
        </span>
        <span className="chip active" style={{ flexShrink: 0 }}>{t("nav.arcade")} →</span>
      </button>

      <input
        className="input"
        placeholder={t("learn.searchCourses")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 14 }}
      />

      {/* categories — full Day 7 set */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {(["All", ...LEARN_CATEGORIES] as const).map((cid) => (
          <button
            key={cid}
            className={`chip${cat === cid ? " active" : ""}`}
            onClick={() => (cid === "All" ? setParams({}) : setParams({ cat: cid }))}
          >
            {catLabel(cid)}
          </button>
        ))}
      </div>

      {/* levels */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {LEVELS.map((lv) => (
          <button key={lv} className={`chip${level === lv ? " active" : ""}`} onClick={() => setLevel(lv)}>
            {lv === "All" ? t("learn.levels") : t(`learn.${lv.toLowerCase()}` as TKey)}
          </button>
        ))}
      </div>

      {/* content types */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 20 }}>
        <button className={`chip${ctype === "all" ? " active" : ""}`} onClick={() => setCtype("all")}>
          {t("learn.contentTypes")}
        </button>
        {CONTENT_TYPES.map((ct) => (
          <button key={ct} className={`chip${ctype === ct ? " active" : ""}`} onClick={() => setCtype(ct)}>
            {CONTENT_TYPE_META[ct].icon} {t(`learn.ct.${ct}` as TKey)}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {list.map((c) => {
          const pct = courseProgress(c.id);
          const minutes = courseMinutes(c);
          const teacher = c.teacherId === "u_sara" ? "Sara Krasniqi" : c.teacherId === "u_alex" ? "Alex Duran" : c.teacherId === "u_maria" ? "Maria Efthymiou" : c.teacherId === "u_denisa" ? "Denisa Hoxha" : c.teacherId === "u_kejsi" ? "Kejsi Tola" : "Maya Santos";
          return (
            <button
              key={c.id}
              onClick={() => nav(`/course/${c.id}`)}
              className="panel panel-hover"
              style={{ textAlign: "left", padding: 0, overflow: "hidden", cursor: "pointer", color: "inherit" }}
            >
              <div style={{ position: "relative", aspectRatio: "16/10", background: "var(--panel-2)" }}>
                <img src={c.cover} alt="" className="media-cover" loading="lazy" />
                <span className="chip" style={{ position: "absolute", top: 10, left: 10, fontSize: 11, padding: "4px 10px", background: "rgba(10,12,16,0.7)" }}>
                  {c.style}
                </span>
                {/* Day 23 — every lesson is free: the badge is unconditional */}
                <span style={{ position: "absolute", bottom: 10, left: 10, background: "rgba(227,179,65,0.95)", color: "#171204", fontSize: 10.5, fontWeight: 800, padding: "4px 9px", borderRadius: 999 }}>
                  {t("learn.access.free")}
                </span>
                {c.isNew && (
                  <span style={{ position: "absolute", top: 10, right: 10, background: "var(--gold)", color: "#131007", fontSize: 10.5, fontWeight: 800, padding: "4px 9px", borderRadius: 999 }}>
                    {t("common.new")}
                  </span>
                )}
              </div>
              <div style={{ padding: "12px 14px 14px" }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>{c.title}</div>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{teacher} · {t(`learn.${c.level.toLowerCase()}` as TKey)} · {minutes} {t("common.min")}</div>
                {pct > 0 ? (
                  <div>
                    <Bar pct={pct} />
                    <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>{pct}%</div>
                  </div>
                ) : (
                  <div className="faint" style={{ fontSize: 11.5 }}>★ {c.rating} · {c.lessons.length} {t("learn.lessons")}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      {list.length === 0 && (
        <p className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
          {t("discover.noResults")} "{q}"
        </p>
      )}
    </div>
  );
}
