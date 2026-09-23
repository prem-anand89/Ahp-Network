// Phase 3 — the Verification Record's own OG image, sharing the sibling
// profile OG image's literal-hex palette (../opengraph-image.tsx) for
// visual consistency between the two, since this page is reached
// directly from that one.

import { ImageResponse } from "next/og";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { getPublicVerificationRecord } from "@/lib/verification-record";

export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BADGE_LABELS: Record<string, string> = {
  credentials_verified: "Credentials Verified",
  qualification_confirmed: "Qualification Confirmed",
};

export default async function Image({ params }: { params: { slug: string } }) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(users)
    .where(and(eq(users.slug, params.slug), eq(users.accountType, "therapist"), isNull(users.deletedAt)));

  const badgeLabel = profile ? BADGE_LABELS[profile.verificationStage] : undefined;
  const record = profile ? await getPublicVerificationRecord(db, profile.id) : [];
  const councilEntry = record.find((r) => r.councilName);

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
        <div style={{ fontSize: 24, fontWeight: 600, color: "#6b6b67", letterSpacing: 2, textTransform: "uppercase" }}>
          Verification Record
        </div>
        <div style={{ fontSize: 52, fontWeight: 600, color: "#1c1c1a", marginTop: 12 }}>
          {profile?.displayName ?? "AHP Network"}
        </div>
        {badgeLabel && (
          <div
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 20px",
              borderRadius: 10,
              // --ahp-verified-bg / --ahp-verified-text, not raw Tailwind green.
              background: "#e7f5ef",
              color: "#1f7a54",
              fontSize: 28,
              fontWeight: 600,
              width: "fit-content",
            }}
          >
            {badgeLabel}
          </div>
        )}
        {councilEntry && (
          <div style={{ marginTop: 24, fontSize: 26, color: "#6b6b67" }}>
            {councilEntry.councilName}
            {councilEntry.registrationNumber ? ` · ${councilEntry.registrationNumber}` : ""}
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
