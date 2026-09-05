// [H2] — polled by .github/workflows/liveness-check.yml on a cadence
// tighter than either job's own staleness threshold. Returns 500 on any
// alert so the workflow's `curl --fail` fails, which GitHub already
// emails/notifies the repo's watchers about — a real, zero-extra-infra
// alerting channel for a solo founder, same pattern the other cron
// workflows already use for auth failures.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import { checkLiveness } from "@/lib/liveness";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await checkLiveness(db);

  return NextResponse.json(result, { status: result.healthy ? 200 : 500 });
}
