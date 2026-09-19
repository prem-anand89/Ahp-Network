// §8H — the automatic, time-based purges. Daily is a coarse-enough
// cadence for month/day-scale windows (unlike the sub-hourly referral
// deadline scheduler) — see .github/workflows/retention.yml.

import { NextResponse } from "next/server";
import { getDb } from "@/db/db";
import { runRetentionPurge } from "@/lib/retention";
import { recomputeExpiredVerificationStages } from "@/lib/credential-expiry";
import { closeStaleAcceptedReferrals } from "@/lib/referral-outcomes";
import { getRuntimeEnv } from "@/lib/runtime-env";
import type { R2Env } from "@/lib/r2";

type RetentionEnv = R2Env & { CRON_SECRET?: string };

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const env = await getRuntimeEnv<RetentionEnv>();
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const result = await runRetentionPurge(db, env);
  // Folded into this same daily job rather than a new Cron Trigger — see
  // src/lib/credential-expiry.ts for why.
  const credentialExpiry = await recomputeExpiredVerificationStages(db);
  // Same reasoning again — REFERRAL_LOOP_SPEC_ADDENDUM.md's 45-day backstop
  // close is day-scale, not the sub-hourly cadence the referral scheduler
  // needs for its 2-hour urgent windows.
  const referralsAutoClosed = await closeStaleAcceptedReferrals(db);

  return NextResponse.json({ ...result, ...credentialExpiry, referralsAutoClosed });
}
