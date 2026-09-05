// §8H — the automatic, time-based purges. Daily is a coarse-enough
// cadence for month/day-scale windows (unlike the sub-hourly referral
// deadline scheduler) — see .github/workflows/retention.yml.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import { runRetentionPurge } from "@/lib/retention";
import type { R2Env } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await runRetentionPurge(db, env as unknown as R2Env);

  return NextResponse.json(result);
}
