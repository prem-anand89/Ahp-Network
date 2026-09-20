// Root OG image — the card shown when the homepage itself (or any route
// without its own opengraph-image.tsx) is shared. Static: no getDb(), no
// per-profile data, so this stays prerendered at build time, unlike the
// per-profile image at (public)/pt/[slug]/opengraph-image.tsx. Hex values
// match globals.css's Layer A palette directly — Satori doesn't resolve
// CSS custom properties, so this is the one place those values are
// duplicated as literals rather than referenced.

import { ImageResponse } from "next/og";
import { SITE_METADATA } from "@/lib/site-metadata";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 96,
          background: "#f8f9fa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 22,
              background: "#00508c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 34,
                height: 18,
                borderLeft: "7px solid white",
                borderBottom: "7px solid white",
                transform: "rotate(-45deg) translate(2px, -4px)",
              }}
            />
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, color: "#16211d" }}>AHP Network</div>
        </div>
        <div style={{ fontSize: 44, fontWeight: 500, color: "#16211d", marginTop: 48, maxWidth: 900 }}>
          {SITE_METADATA.description}
        </div>
        <div style={{ fontSize: 26, color: "#1f7a54", fontWeight: 600, marginTop: 40 }}>
          Verified by document, not by algorithm
        </div>
      </div>
    ),
    { ...size },
  );
}
