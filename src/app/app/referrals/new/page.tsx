// §8D — the referral posting page. Under /app/*, therapist-facing only.

import { getAreaZones } from "@/lib/areas";
import { getDb } from "@/db/db";
import { listCircles } from "@/lib/circles";
import { requireAuthUserId } from "@/lib/require-session";
import { PostReferralForm } from "./post-referral-form";

export const dynamic = "force-dynamic";

export default async function PostReferralPage() {
  const userId = await requireAuthUserId();
  const db = await getDb();
  // Execution-plan Phase 4 — offered as a targeting choice only when the
  // poster actually has a circle to target; zero circles means the "Just
  // one of my circles" option has nothing to point at, so it's simplest
  // (and least confusing) to not render it at all rather than show a
  // picker with nothing in it.
  const [zones, circles] = await Promise.all([getAreaZones(), listCircles(db, userId)]);

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
