// §10H — "This week in your network." Fires weekly (see
// .github/workflows/weekly-digest.yml), one week apart, well outside any
// referral timing window so a plain HTTP route on a coarse cadence is
// fine here in a way it wouldn't be for the referral deadline scheduler.
// Only enqueues into notification_outbox — the existing notification-
// worker cron (every 2 minutes) is what actually sends.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import { enqueueWeeklyDigests } from "@/lib/weekly-digest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await enqueueWeeklyDigests(db);

  return NextResponse.json(result);
}
