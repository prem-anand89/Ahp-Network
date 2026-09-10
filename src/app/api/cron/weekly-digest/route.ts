// §10H — "This week in your network." Fires weekly (see
// .github/workflows/weekly-digest.yml), one week apart, well outside any
// referral timing window so a plain HTTP route on a coarse cadence is
// fine here in a way it wouldn't be for the referral deadline scheduler.
// Only enqueues into notification_outbox — the existing notification-
// worker cron (every 2 minutes) is what actually sends.
//
// Also runs §8E3's community auto-generation job on the same weekly
// cadence — the plan itself says this reuses an existing weekly slot
// rather than justifying new infrastructure ("no new infrastructure
// category"), and Cloudflare's free plan caps Cron Triggers at 5, all of
// which are already spoken for (src/lib/cron-routes.ts). It's gated
// behind the ≥100-verified-active-therapists macro gate and simply won't
// fire during the pilot.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import { enqueueWeeklyDigests } from "@/lib/weekly-digest";
import { runCommunityAutoGeneration } from "@/lib/community-auto-generation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const digest = await enqueueWeeklyDigests(db);
  const communityAutoGeneration = await runCommunityAutoGeneration(db);

  return NextResponse.json({ digest, communityAutoGeneration });
}
