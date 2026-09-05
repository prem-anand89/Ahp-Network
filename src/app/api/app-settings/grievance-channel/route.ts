// §1B/§8G5 — whether the grievance officer address may be shown in the
// public footer. A separate route handler, not a direct DB read inside
// the (public) layout: that layout must never call getDb() (see
// scripts/check-public-routes-static.mjs) or the whole SEO-facing
// directory subtree loses its static/ISR rendering. The footer's
// grievance link fetches this client-side instead.

import { NextResponse } from "next/server";
import { getDb } from "@/db/db";
import { isGrievanceChannelPublished } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const published = await isGrievanceChannelPublished(db);
  return NextResponse.json({ published });
}
