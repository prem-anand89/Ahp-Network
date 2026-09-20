// §8D — the referral posting page. Under /app/*, therapist-facing only.

import { getAreaZones } from "@/lib/areas";
import { getDb } from "@/db/db";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { listCircles } from "@/lib/circles";
import { PostReferralForm } from "./post-referral-form";

export const dynamic = "force-dynamic";

export default async function PostReferralPage() {
  const userId = await getVerifiedUserId();
  const db = await getDb();
  const [zones, circles] = await Promise.all([
    getAreaZones(),
    userId ? listCircles(db, userId) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Post a referral</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Only structured fields and your patient summary are shared with matched therapists — never
        their name, phone number, or exact address.
      </p>
      <div className="mt-6">
        <PostReferralForm zones={zones} circles={circles} />
      </div>
    </main>
  );
}
