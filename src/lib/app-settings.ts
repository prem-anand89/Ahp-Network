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

export interface SetAppSettingInput {
  actingUserId: string;
  key: string;
  value: unknown;
}
