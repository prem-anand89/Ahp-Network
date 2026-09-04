"use server";

// §8G4 (Phase 7) — storing/removing a browser's push subscription.

import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { pushSubscriptions } from "@/db/schema";

async function requireAuthUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

export interface SubscribePushInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function subscribeToPush(input: SubscribePushInput) {
  const userId = await requireAuthUserId();
  const db = await getDb();

  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: input.p256dh, auth: input.auth, lastSeenAt: new Date() },
    });
}

export async function unsubscribeFromPush(endpoint: string) {
  await requireAuthUserId();
  const db = await getDb();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}
