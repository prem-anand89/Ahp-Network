// §8D — the sub-hourly deadline-scheduler entry point. Triggered by
// .github/workflows/referral-scheduler.yml on a 15-minute cadence (well
// under the 2-hour urgent offer window this exists to service). A plain
// HTTP route rather than a Cloudflare Cron Trigger's native `scheduled()`
// handler — OpenNext's generated Worker only exports `fetch`, and
// adding a second entrypoint alongside it is more risk than a secret-
// header-gated route triggered by an external scheduler.
//
// Only sweeps lapse_offers() for now. It deliberately does NOT call the
// notification_outbox worker (src/lib/notification-outbox-worker.ts):
// that worker's `send` function is Phase 7's job (VAPID push/email
// wiring). Calling processOutboxOnce with a stub sender here would mark
// real notifications 'sent' without ever delivering them — silently
// dropping every push in the pilot. Wire the real sender in before this
// route calls it.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/db/db";
import { sweepLapsedOffers } from "@/lib/referral-scheduler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // A Workers Secret, same as R2's access keys and the Vision key — never
  // a plain wrangler.jsonc `var`, never process.env (that's Node's model,
  // not how bindings reach a Worker).
  const { env } = await getCloudflareContext({ async: true });
  const secret = (env as unknown as { CRON_SECRET?: string }).CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const { swept } = await sweepLapsedOffers(db);

  return NextResponse.json({ swept });
}
