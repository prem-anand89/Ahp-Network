// §8C3 — the practice profile's shareable OG image. Same restrained
// pattern as /pt/[slug]/opengraph-image.tsx: structured facts only, no
// numeric or comparative claim (§1A). Rendered only for claimed practices
// — an unclaimed listing gets no card to share, matching its noindex/
// no-schema.org treatment in page.tsx.

import { ImageResponse } from "next/og";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/db";
import { practices } from "@/db/schema";

// Deliberately dynamic — see the note in ../page.tsx: getDb() needs the
// live Worker's Hyperdrive binding, unavailable at build time.
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PRACTICE_TYPE_LABELS: Record<string, string> = {
  clinic: "Clinic",
  hospital_department: "Hospital department",
  home_care_agency: "Home care agency",
  wellness_center: "Wellness center",
  other: "Practice",
};

export default async function Image({ params }: { params: { slug: string } }) {
  const db = await getDb();
  const [practice] = await db
    .select()
    .from(practices)
    .where(and(eq(practices.slug, params.slug), isNull(practices.deletedAt)));

  const isClaimed = practice?.claimStatus === "claimed";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#faf9f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 56, fontWeight: 600, color: "#1c1c1a" }}>
          {practice?.name ?? "AHP Network"}
        </div>
        {practice?.type && (
          <div style={{ fontSize: 32, color: "#6b6b67", marginTop: 8 }}>
            {PRACTICE_TYPE_LABELS[practice.type] ?? "Practice"}
          </div>
        )}
        {isClaimed && (
          <div
            style={{
              marginTop: 32,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 20px",
              borderRadius: 8,
              background: "#fde8e0",
              color: "#8a3a1f",
              fontSize: 28,
              fontWeight: 600,
              width: "fit-content",
            }}
          >
            Ownership Verified
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
