DENSEN ACADEMY — OFFICIAL BRAND ASSETS (drop-in)
================================================

Put the official logo files here:

  logo.png        The full lockup (gold "DENSEN" + underlined "ACADEMY").
                  Used by: shell header, auth pages, onboarding, admin.
                  Any size works; original artwork is ~1500x1000.

  logo-icon.png   Square crop of the mark (the "DENSEN" gold lettering or
                  the D monogram), 512x512 or 1024x1024.
                  Used by: favicon (browser tab), iOS home-screen icon,
                  and social embed preview (og:image).

No code changes needed: BrandLogo.tsx renders these automatically when
present, and falls back to the built-in gold wordmark / gold-D SVG when
they are missing — the app never shows a broken image.

Brand rules (DENSEN identity):
  - Dark background only (#0b0d10 family). Never place on light surfaces.
  - The gold is #e3b341 (gradient #f0c75e -> #cf9a35). Do not recolor.
  - Keep clear space around the lockup; do not stretch or rotate.
