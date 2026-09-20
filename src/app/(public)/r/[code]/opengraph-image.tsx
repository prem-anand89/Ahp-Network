// Phase 5 — the receipt's shareable OG image. Same restrained pattern as
// /pt/[slug]/opengraph-image.tsx and /clinic/[slug]/opengraph-image.tsx:
// structured facts only, no numeric or comparative claim (§1A), and
// never a per-person count anywhere — this card is about one referral.

import { ImageResponse } from "next/og";
import { getDb } from "@/db/db";
import { getReceiptByCode } from "@/lib/referral-receipt";
import { SPECIALIZATION_LABELS } from "@/lib/referral-labels";

// Deliberately dynamic — see the note in ../page.tsx: getDb() needs the
// live Worker's Hyperdrive binding, unavailable at build time.
export const dynamic = "force-dynamic";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { code: string } }) {
  const db = await getDb();
  const receipt = await getReceiptByCode(db, params.code);

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
        <div style={{ fontSize: 28, color: "#6b6b67", letterSpacing: 1 }}>
          {receipt?.publicRefCode ?? "AHP Network"}
        </div>
        <div style={{ fontSize: 48, fontWeight: 600, color: "#1c1c1a", marginTop: 12 }}>
          {receipt
            ? `${SPECIALIZATION_LABELS[receipt.specializationNeeded] ?? receipt.specializationNeeded} referral`
            : "Referral receipt"}
        </div>
        {receipt && (
          <div style={{ fontSize: 26, color: "#6b6b67", marginTop: 20 }}>
            {receipt.posterDisplayName ?? "A therapist"} → {receipt.accepterDisplayName ?? "a therapist"}
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}
