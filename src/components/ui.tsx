import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ME, useStore, users as storeUsers } from "../state/store";
import { BrandLogo } from "./BrandLogo";

/* ---------------- Avatar ---------------- */
export function Avatar({ src, size = 40, ring }: { src: string; size?: number; ring?: boolean }) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        border: ring ? "2px solid var(--gold)" : "1px solid var(--line-strong)",
        flexShrink: 0,
      }}
    />
  );
}

/* ---------------- Logo (official brandmark — see BrandLogo.tsx) ----------------
 * Thin wrapper so every existing call site keeps working. Renders the official
 * DENSEN ACADEMY artwork when public/brand/logo.png is present; otherwise the
 * gold wordmark fallback (same shape, same sizing). */
export function Logo({ size = 26 }: { size?: number }) {
  return <BrandLogo size={size} />;
}

/* ---------------- Section header ---------------- */
export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <h2 style={{ fontSize: 19, fontWeight: 700 }}>{title}</h2>
      {action && (
        <button
          onClick={onAction}
          style={{ background: "none", border: "none", color: "var(--gold)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
        >
          {action} →
        </button>
      )}
    </div>
  );
}

/* ---------------- Progress bar ---------------- */
export function Bar({ pct, lg }: { pct: number; lg?: boolean }) {
  return (
    <div className={`bar${lg ? " lg" : ""}`}>
      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

/* ---------------- Circular progress ---------------- */
export function Ring({ pct, size = 92, stroke = 8, label, sub }: { pct: number; size?: number; stroke?: number; label?: string; sub?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--gold)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontFamily: "Sora", fontWeight: 800, fontSize: size * 0.24 }}>{label ?? `${Math.round(pct)}%`}</span>
        {sub && <span className="faint" style={{ fontSize: 10 }}>{sub}</span>}
      </div>
    </div>
  );
}

/* ---------------- Level / stat chip ---------------- */
export function StatCard({ icon, value, label, accent }: { icon: string; value: string | number; label: string; accent?: boolean }) {
  return (
    <div className="panel" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontFamily: "Sora", fontWeight: 800, fontSize: 24, color: accent ? "var(--gold)" : undefined }}>
        {value}
      </span>
      <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

/* ---------------- Difficulty badge ---------------- */
export function LevelBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    Beginner: "rgba(74,222,128,0.16)",
    Intermediate: "rgba(227,179,65,0.16)",
    Advanced: "rgba(248,113,113,0.16)",
    Kids: "rgba(147,197,253,0.16)",
  };
  const color: Record<string, string> = {
    Beginner: "#4ade80",
    Intermediate: "var(--gold)",
    Advanced: "#f87171",
    Kids: "#93c5fd",
  };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: 999,
        background: map[level] ?? "rgba(255,255,255,0.1)",
        color: color[level] ?? "var(--ink-dim)",
        whiteSpace: "nowrap",
      }}
    >
      {level}
    </span>
  );
}

/* ---------------- Toast host ---------------- */
export function ToastHost() {
  const { toasts } = useStore();
  return (
    <div
      style={{
        position: "fixed",
        bottom: "calc(84px + var(--sab))",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 200,
        width: "min(92vw, 380px)",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="anim-rise"
          style={{
            background: "#1e232e",
            border: "1px solid var(--gold-line)",
            borderRadius: 14,
            padding: "12px 18px",
            fontSize: 13.5,
            fontWeight: 600,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
            textAlign: "center",
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Post/course action row helpers ---------------- */
export function ActionBtn({
  active,
  icon,
  label,
  onClick,
  small,
}: {
  active?: boolean;
  icon: React.ReactNode;
  label?: string;
  onClick?: () => void;
  small?: boolean;
}) {
  const [pop, setPop] = useState(false);
  return (
    <button
      className="anim-target"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setPop(true);
        window.setTimeout(() => setPop(false), 450);
        onClick?.();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        background: "none",
        border: "none",
        color: active ? "var(--gold)" : "white",
        cursor: "pointer",
        fontSize: small ? 11 : 12,
        fontWeight: 700,
      }}
      key={pop ? "p" : "n"}
    >
      <span className={pop ? "anim-pop" : ""} style={{ fontSize: small ? 18 : 22, lineHeight: 1 }}>
        {icon}
      </span>
      {label !== undefined && <span>{label}</span>}
    </button>
  );
}

/* ---------------- Horizontal scroller with arrows ---------------- */
export function HScroll({ children, gap = 14 }: { children: ReactNode; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft < 8);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  };
  useEffect(() => {
    update();
  }, []);

  const scrollBy = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: "smooth" });

  return (
    <div style={{ position: "relative" }}>
      <div ref={ref} className="no-scrollbar" onScroll={update} style={{ display: "flex", gap, overflowX: "auto", scrollSnapType: "x proximity", paddingBottom: 4 }}>
        {children}
      </div>
      {!atStart && (
        <button
          onClick={() => scrollBy(-320)}
          className="hide-mobile"
          style={{
            position: "absolute",
            left: -14,
            top: "50%",
            transform: "translateY(-50%)",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "1px solid var(--line-strong)",
            background: "rgba(10,12,16,0.85)",
            color: "white",
            cursor: "pointer",
            zIndex: 5,
          }}
        >
          ‹
        </button>
      )}
      {!atEnd && (
        <button
          onClick={() => scrollBy(320)}
          className="hide-mobile"
          style={{
            position: "absolute",
            right: -14,
            top: "50%",
            transform: "translateY(-50%)",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "1px solid var(--line-strong)",
            background: "rgba(10,12,16,0.85)",
            color: "white",
            cursor: "pointer",
            zIndex: 5,
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}

/* ---------------- Shared profile link ---------------- */
export function UserLink({ id, size = 34, showName }: { id: string; size?: number; showName?: boolean }) {
  const u = id === "me" ? ME : storeUsers.find((x) => x.id === id);
  if (!u) return null;
  return (
    <Link to={`/user/${id}`} style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none" }}>
      <Avatar src={u.avatar} size={size} />
      {showName && <span style={{ fontWeight: 700, fontSize: 13.5 }}>{u.name}</span>}
    </Link>
  );
}

/* ---------------- Empty state ---------------- */
export function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--ink-faint)" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{text}</p>
    </div>
  );
}

/* ---------------- Page container ---------------- */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className="anim-fade"
      style={{ maxWidth: wide ? 1160 : 860, margin: "0 auto", padding: "20px 16px 110px" }}
    >
      {children}
    </div>
  );
}
