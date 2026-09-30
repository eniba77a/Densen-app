import { useState } from "react";

/**
 * DENSEN ACADEMY — official brandmark integration (Day 20).
 * ========================================================
 * The uploaded logo (gold "DENSEN" + underlined "ACADEMY" on black) is the
 * single brand surface for EVERYTHING: shell header, auth, onboarding,
 * admin, favicon, PWA tile, and social embeds.
 *
 * Asset contract (drop-in, zero code changes needed):
 *   public/brand/logo.png       the artwork (1500×1000 or any ratio)
 *   public/brand/logo-icon.png  square crop of the "D" mark (for favicon/tile)
 *
 * Drop the file(s) in `public/brand/` and every surface picks it up — the
 * <img> simply starts resolving and the fallback never shows. Missing file ⇒
 * the gold wordmark below renders instead (Cinzel/Sora gradient), so the app
 * NEVER ships a broken image.
 */
const LOGO_SRC = `${import.meta.env.BASE_URL}brand/logo.png`;
const ICON_SRC = `${import.meta.env.BASE_URL}brand/logo-icon.png`;

let iconVerified = false; // module-level: one probe per page load

/** True when public/brand/logo-icon.png exists (probed once, cached). */
export function hasIconAsset(): boolean {
  if (iconVerified) return true;
  fetch(ICON_SRC, { method: "HEAD" })
    .then((r) => {
      iconVerified = r.ok;
      if (iconVerified) {
        // Swap favicon + PWA tile + social image the moment the asset lands.
        for (const sel of [
          "link[rel='icon']",
          "link[rel='apple-touch-icon']",
          "link[rel='shortcut icon']",
        ]) {
          const el = document.querySelector<HTMLLinkElement>(sel);
          if (el) el.href = ICON_SRC;
        }
        const og = document.querySelector<HTMLMetaElement>("meta[property='og:image']");
        if (og) og.content = ICON_SRC;
      }
    })
    .catch(() => {});
  return false;
}

export function BrandLogo({
  size = 26,
  variant = "full",
}: {
  size?: number;
  /** full = DENSEN + ACADEMY lockup · mark = icon-only (D mark / "D") */
  variant?: "full" | "mark";
}) {
  const [imgOk, setImgOk] = useState(true);

  // Icon variant: square brandmark for compact surfaces (bottom tab, avatar).
  if (variant === "mark") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", lineHeight: 1 }}>
        <img
          src={ICON_SRC}
          alt="DENSEN"
          width={size}
          height={size}
          style={{ display: imgOk ? "block" : "none", borderRadius: 6 }}
          onError={() => setImgOk(false)}
        />
        {!imgOk && (
          <span
            className="gold-grad-text"
            aria-label="DENSEN"
            style={{
              fontFamily: "Sora",
              fontWeight: 900,
              fontSize: size * 0.92,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: size,
              height: size,
              borderRadius: 6,
              background: "rgba(227,179,65,0.08)",
              border: "1px solid var(--gold-line, rgba(227,179,65,0.35))",
            }}
          >
            D
          </span>
        )}
      </span>
    );
  }

  // Full lockup: the official artwork, else the gold wordmark fallback.
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, lineHeight: 1 }}>
      <img
        src={LOGO_SRC}
        alt="DENSEN Academy"
        style={{
          height: size * 1.7,
          width: "auto",
          display: imgOk ? "block" : "none",
          filter: "drop-shadow(0 2px 14px rgba(227,179,65,0.25))",
        }}
        onError={() => setImgOk(false)}
      />
      {!imgOk && (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
          <span
            className="gold-grad-text"
            style={{ fontFamily: "Sora", fontWeight: 800, fontSize: size, letterSpacing: "0.02em" }}
          >
            DENSEN
          </span>
          <span
            style={{
              fontFamily: "Sora",
              fontWeight: 700,
              fontSize: size * 0.44,
              color: "var(--ink-dim)",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
            }}
          >
            Academy
          </span>
        </span>
      )}
    </span>
  );
}
