// §8G5 — narrow reader for the app_settings key/value table. Never a
// generic settings API: each consumer names the exact key it needs.

import { eq } from "drizzle-orm";
import { appSettings } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

/** Default false — §8G5: don't publish the grievance officer address
 * until a named admin is actually checking the inbox. */
export async function isGrievanceChannelPublished(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "grievance_channel_published"));
  return row?.value === true;
}

/** Generic read — one key, whatever shape its value happens to be. Each
 * caller still names the exact key it wants; this isn't a generic
 * settings API surfaced anywhere. */
export async function getAppSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key));
  return row?.value;
}

/** Upsert — used by [H2]'s per-job heartbeats (src/lib/liveness.ts) and
 * any other small piece of operational state that fits a key/value row
 * better than a dedicated column somewhere. */
export async function setAppSetting(db: Db, key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
