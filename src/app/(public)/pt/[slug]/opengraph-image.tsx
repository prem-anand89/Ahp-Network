// §10F — the profile card shared as the OG image. Deliberately simple:
// the same structured facts as ProfileCard, rendered server-side. Never
// any numeric or comparative claim about the therapist (§1A).

import { ImageResponse } from "next/og";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";

// Deliberately dynamic — see the note in ../page.tsx: getDb() needs the
// live Worker's Hyperdrive binding, unavailable at build time.
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ROLE_LABELS: Record<string, string> = {
  physiotherapist: "Physiotherapist",
  occupational_therapist: "Occupational Therapist",
  speech_language_pathologist: "Speech-Language Pathologist",
};

const BADGE_LABELS: Record<string, string> = {
  credentials_verified: "Credentials Verified",
  qualification_confirmed: "Qualification Confirmed",
};

export default async function Image({ params }: { params: { slug: string } }) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.slug, params.slug),
        eq(users.accountType, "therapist"),
        isNull(users.deletedAt),
      ),
    );

  const badgeLabel = profile ? BADGE_LABELS[profile.verificationStage] : undefined;

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
          {profile?.displayName ?? "AHP Network"}
        </div>
        {profile?.role && (
          <div style={{ fontSize: 32, color: "#6b6b67", marginTop: 8 }}>
            {ROLE_LABELS[profile.role]}
          </div>
        )}
        {badgeLabel && (
          <div
            style={{
              marginTop: 32,
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 20px",
              borderRadius: 10,
              background: "#dcfce7",
              color: "#166534",
              fontSize: 28,
              fontWeight: 600,
              width: "fit-content",
            }}
          >
            {badgeLabel}
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
