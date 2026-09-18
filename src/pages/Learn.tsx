import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bar } from "../components/ui";
import { useStore } from "../state/store";
import { courseCategories, courses } from "../data/store";
import type { TKey } from "../i18n";

export default function Learn() {
  const { t, courseProgress } = useStore();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const cat = params.get("cat") ?? "All";
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<"All" | "Beginner" | "Intermediate" | "Advanced" | "Kids">("All");

  const list = useMemo(
    () =>
      courses.filter(
        (c) =>
          (cat === "All" || c.style === cat) &&
          (level === "All" || c.level === level) &&
          (q.trim() === "" ||
            c.title.toLowerCase().includes(q.toLowerCase()) ||
            c.style.toLowerCase().includes(q.toLowerCase()))
      ),
    [cat, level, q]
  );

  return (
    <div className="anim-fade" style={{ maxWidth: 1160, margin: "0 auto", padding: "22px 16px 110px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>{t("learn.title")}</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>{t("learn.subtitle")}</p>
      </div>

      <input
        className="input"
        placeholder={t("learn.searchCourses")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {/* categories */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 10 }}>
        {["All", ...courseCategories.map((c) => c.id)].map((cid) => (
          <button
            key={cid}
            className={`chip${cat === cid ? " active" : ""}`}
            onClick={() => (cid === "All" ? setParams({}) : setParams({ cat: cid }))}
          >
            {cid === "All" ? t("learn.all") : cid}
          </button>
        ))}
      </div>

      {/* levels */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 20 }}>
        {(["All", "Beginner", "Intermediate", "Advanced", "Kids"] as const).map((lv) => (
          <button key={lv} className={`chip${level === lv ? " active" : ""}`} onClick={() => setLevel(lv)}>
            {lv === "All" ? t("learn.levels") : t(`learn.${lv.toLowerCase()}` as TKey)}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
        {list.map((c) => {
          const pct = courseProgress(c.id);
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
                {c.isNew && (
                  <span style={{ position: "absolute", top: 10, right: 10, background: "var(--gold)", color: "#131007", fontSize: 10.5, fontWeight: 800, padding: "4px 9px", borderRadius: 999 }}>
                    {t("common.new")}
                  </span>
                )}
              </div>
              <div style={{ padding: "12px 14px 14px" }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 4 }}>{c.title}</div>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{teacher} · {t(`learn.${c.level.toLowerCase()}` as TKey)}</div>
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
