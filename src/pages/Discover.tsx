import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar, LevelBadge, Page } from "../components/ui";
import { IcSearch, IcVerified } from "../components/icons";
import { useStore } from "../state/store";
import { useAuth } from "../state/auth";
import { fmt } from "../data/store";
import { IMG } from "../data/media";

/**
 * Day 17 — DENSEN DISCOVER.
 *
 * Fully database-backed via discoverWire (searchAll / searchSuggestions /
 * discoverFeed). Guests see the public catalog; signed-in dancers get the
 * age-safe, privacy-respecting result set the server decides (the client
 * never re-filters — the wire output is already the safe set).
 */

type ResultRow = {
  id: string;
  kind: string;
  label: string;
  subtitle?: string;
  verified?: boolean;
  level?: string;
  priceCents?: number;
  isFree?: boolean;
  popularity?: number;
  city?: string;
};

type Section = { id: string; title: string; results: ResultRow[] };

type Tab = "all" | "classes" | "moves" | "dancers" | "challenges" | "hashtags";

const TAB_KINDS: Record<Exclude<Tab, "all">, string[]> = {
  classes: ["class", "course"],
  moves: ["move", "combo", "choreography"],
  dancers: ["dancer", "teacher"],
  challenges: ["challenge"],
  hashtags: ["hashtag", "style"],
};

const SECTION_ICONS: Record<string, string> = {
  trending_moves: "🔥",
  trending_choreos: "🎬",
  teachers: "👑",
  challenges: "⚡",
  styles: "🪩",
  beginner: "🎯",
  rising: "🚀",
  new_classes: "🆕",
  under5: "💰",
  free: "🆓",
};

const KIND_LABEL: Record<string, string> = {
  dancer: "Dancer",
  teacher: "Teacher",
  move: "Move",
  combo: "Combo",
  choreography: "Choreography",
  class: "Class",
  course: "Course",
  challenge: "Challenge",
  style: "Style",
  hashtag: "Hashtag",
};

/** Stable avatar/cover per row id (placeholder media registry). */
const FALLBACKS = [
  IMG.extra1, IMG.extra2, IMG.extra3, IMG.extra4, IMG.extra5, IMG.extra6,
  IMG.extra7, IMG.extra8, IMG.extra9, IMG.extra10, IMG.extra11, IMG.extra12,
];
function fallbackFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}

/** Day 23 — free platform: classes/courses show Free; prices are gone. */
function priceLabel(r: ResultRow): string | null {
  if (r.isFree) return "Free";
  if (r.priceCents === undefined) return null;
  return "Free";
}

export default function Discover() {
  const { t } = useStore();
  const { sessionToken } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [tab, setTab] = useState<Tab>("all");
  const [focused, setFocused] = useState(false);

  useEffect(() => setInput(q), [q]);

  const args = sessionToken ? { sessionToken } : {};
  const feed = useQuery(api.discoverWire.discoverFeed, args) as
    | { ok: boolean; sections: Section[] }
    | undefined;
  const search = useQuery(
    api.discoverWire.searchAll,
    q.trim().length >= 2 ? { ...args, q, kinds: tab === "all" ? undefined : TAB_KINDS[tab] } : "skip",
  ) as { ok: boolean; total: number; results: ResultRow[] } | undefined;
  const suggestions = useQuery(
    api.discoverWire.searchSuggestions,
    focused && input.trim().length >= 2
      ? { sessionToken: sessionToken ?? undefined, q: input }
      : "skip",
  ) as { ok: boolean; suggestions: { text: string; kind: string }[] } | undefined;

  const runSearch = (value: string) => {
    setParams(value ? { q: value } : {});
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const sections = useMemo(() => {
    if (!feed?.ok) return [];
    // Search mode replaces the rails; idle shows the themed rails.
    return q.trim().length >= 2 ? [] : feed.sections;
  }, [feed, q]);

  const results = search?.ok ? search.results : [];
  const suggestionList = suggestions?.ok ? suggestions.suggestions : [];

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: t("discover.all") },
    { id: "classes", label: t("discover.courses") },
    { id: "moves", label: t("discover.trendingMoves") },
    { id: "dancers", label: t("discover.dancers") },
    { id: "challenges", label: t("nav.challenges") },
    { id: "hashtags", label: t("discover.hashtags") },
  ];

  const openRow = (r: ResultRow) => {
    switch (r.kind) {
      case "dancer":
      case "teacher":
        nav(`/user/${r.id}`);
        break;
      case "class":
      case "course":
        nav(`/course/${r.id}`);
        break;
      case "challenge":
        nav(`/challenge/${r.id}`);
        break;
      case "hashtag":
        runSearch(`#${r.label}`);
        break;
      case "style":
        runSearch(r.label);
        break;
      default:
        runSearch(r.label);
    }
  };

  const rowCard = (r: ResultRow) => {
    const price = priceLabel(r);
    const kindLabel = KIND_LABEL[r.kind] ?? r.kind;
    return (
      <button
        key={r.id}
        onClick={() => openRow(r)}
        className="panel panel-hover"
        style={{
          display: "flex", gap: 12, padding: 10, alignItems: "center",
          cursor: "pointer", textAlign: "left", color: "inherit", width: "100%",
        }}
      >
        {r.kind === "dancer" || r.kind === "teacher" ? (
          <Avatar src={fallbackFor(r.id)} size={46} ring={r.kind === "teacher"} />
        ) : (
          <img
            src={fallbackFor(r.id)}
            alt=""
            loading="lazy"
            style={{ width: 62, height: 46, objectFit: "cover", borderRadius: 10, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.kind === "hashtag" ? `#${r.label}` : r.label}
            </span>
            {r.verified && <IcVerified />}
          </div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 2, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span>{kindLabel}</span>
            {r.level && <LevelBadge level={r.level} />}
            {price && <span style={{ color: r.isFree ? "var(--gold)" : undefined, fontWeight: 700 }}>{price}</span>}
            {r.city && <span>📍 {r.city}</span>}
            {r.kind === "hashtag" && r.popularity !== undefined && r.popularity > 0 && (
              <span>{fmt(r.popularity)} {t("discover.videos")}</span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <Page>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 14 }}>{t("discover.title")}</h1>

      {/* Search + live suggestions */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}>
          <IcSearch />
        </span>
        <input
          className="input"
          placeholder={t("discover.searchPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch(input)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          style={{ paddingLeft: 42 }}
          aria-label={t("discover.title")}
        />
        {input && (
          <button
            onClick={() => { setInput(""); runSearch(""); }}
            aria-label={t("common.cancel")}
            style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--ink-faint)", fontSize: 18, cursor: "pointer" }}
          >
            ✕
          </button>
        )}
        {focused && suggestionList.length > 0 && (
          <div
            className="panel"
            style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 30, padding: 6, boxShadow: "var(--shadow-lg, 0 12px 32px rgba(0,0,0,0.35))" }}
          >
            {suggestionList.map((s) => (
              <button
                key={`${s.kind}:${s.text}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setInput(s.text); runSearch(s.text); }}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 10,
                  background: "none", border: "none", color: "inherit",
                  padding: "9px 10px", borderRadius: 9, cursor: "pointer", textAlign: "left",
                }}
              >
                <span className="faint" style={{ fontSize: 13, width: 18, textAlign: "center" }}>
                  {s.kind === "hashtag" ? "#" : s.kind === "dancer" || s.kind === "teacher" ? "👤" : s.kind === "challenge" ? "⚡" : s.kind === "style" ? "🪩" : "🎬"}
                </span>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.text}</span>
                <span className="faint" style={{ marginLeft: "auto", fontSize: 11 }}>{KIND_LABEL[s.kind] ?? s.kind}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 20 }}>
        {tabs.map((tb) => (
          <button key={tb.id} className={`chip${tab === tb.id ? " active" : ""}`} onClick={() => setTab(tb.id)}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ---------- SEARCH MODE ---------- */}
      {q.trim().length >= 2 ? (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>
            {search === undefined ? "…" : `${results.length} ${t("discover.noResults").split(" ")[0] === "No" ? "" : ""}`.trim() || ""}
            {search !== undefined && <span className="faint" style={{ fontWeight: 500 }}> "{q}"</span>}
          </h2>
          {search === undefined ? (
            <p className="muted" style={{ fontSize: 14 }}>…</p>
          ) : results.length === 0 ? (
            <p className="muted" style={{ fontSize: 14 }}>
              {t("discover.noResults")} "{q}" — {t("discover.tryDifferent")}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {results.map(rowCard)}
            </div>
          )}
        </section>
      ) : (
        <>
          {/* ---------- IDLE: style chips + discover rails ---------- */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {["Hip-Hop", "Commercial", "Contemporary", "Jazz", "Latin", "Beginner"].map((s) => (
              <button key={s} className="chip" onClick={() => { setInput(s); runSearch(s); }}>
                {s}
              </button>
            ))}
          </div>

          {feed === undefined ? (
            <p className="muted" style={{ fontSize: 14, textAlign: "center", padding: "24px 0" }}>…</p>
          ) : (
            sections.map((sec) => (
              <section key={sec.id} style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 17, marginBottom: 12 }}>
                  {SECTION_ICONS[sec.id] ?? "✨"} {t(`discover.rail.${sec.id}` as never)}
                </h2>
                <div
                  className="no-scrollbar"
                  style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}
                >
                  {sec.results.map((r) => (
                    <div key={r.id} style={{ flex: "0 0 auto", width: sec.id === "styles" ? 150 : 230 }}>
                      {rowCard(r)}
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}

          {/* Guest CTA — the safe public rails end here; sign in unlocks people search */}
          {!sessionToken && (
            <div className="panel" style={{ padding: 18, textAlign: "center", marginBottom: 20 }}>
              <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 14 }}>{t("discover.guestCta")}</p>
              <button className="btn btn-primary" onClick={() => nav("/register")}>
                {t("auth.submit")}
              </button>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
