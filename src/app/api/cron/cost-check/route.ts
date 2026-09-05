// Phase 12 — the one cost-trigger check that's actually a SQL query
// (Supabase connection utilization, §7). Polled by
// .github/workflows/cost-check.yml; a non-2xx response fails that
// workflow, which GitHub already notifies the repo's watchers about.
// R2 storage, Hyperdrive daily query count, Google Places spend, and OCR
// volume are Cloudflare/GCP billing metrics with no equivalent query —
// see docs/cost-alerts-runbook.md for those.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import { checkCostTriggers } from "@/lib/cost-checks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await checkCostTriggers(db);

  return NextResponse.json(result, { status: result.healthy ? 200 : 500 });
}
