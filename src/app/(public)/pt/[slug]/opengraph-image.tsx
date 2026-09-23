// §10F — the profile card shared as the OG image. Deliberately simple:
// the same structured facts as ProfileCard, rendered server-side. Never
// any numeric or comparative claim about the therapist (§1A).

import { ImageResponse } from "next/og";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { SPECIALIZATION_LABELS } from "@/lib/referral-labels";

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
  // §10F — founding-cohort framing lives in the profile's permanent OG
  // image, gated on is_founding_member. Every account created before the
  // §14 go/no-go review carries this, so it disappears platform-wide the
  // moment that review flips FOUNDING_COHORT_OPEN to false.
  const isFoundingMember = profile?.isFoundingMember ?? false;

  const specialtyLabels = (profile?.specializations ?? [])
    .slice(0, 3)
    .map((s) => SPECIALIZATION_LABELS[s] ?? s);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#faf9f7",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
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
                // --ahp-verified-bg / --ahp-verified-text from globals.css,
                // not the raw Tailwind green-100/green-800 this used to be.
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
          {specialtyLabels.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
              {specialtyLabels.map((label) => (
                <div
                  key={label}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 999,
                    border: "1.5px solid #d8dcda",
                    color: "#3d453f",
                    fontSize: 22,
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          )}
          {isFoundingMember && (
            <div style={{ marginTop: 16, fontSize: 22, color: "#8a6d00", fontWeight: 600 }}>
              Founding member — AHP Network
            </div>
          )}
        </div>

        {/* Satori can't render the real Logo component (Tailwind classes,
            next/font className) — see its own header comment. This is a
            deliberately simplified, inline-style stand-in for OG images
            only, matched to the same --primary token. */}
        <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>
          <span style={{ color: "#00508c" }}>ahp</span>
          <span style={{ color: "#1c1c1a" }}>network</span>
          <span style={{ color: "#e41e26" }}>.</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
