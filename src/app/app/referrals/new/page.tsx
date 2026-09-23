// §8D — the referral posting page. Under /app/*, therapist-facing only.
// Round 2 — also the landing spot for the profile "Refer Patient" CTA
// (?refer=<therapistUserId>), which arrives with a First Look target
// already chosen: same form, same matching/shortlist/accept path, no
// direct-assignment shortcut (plan decision 7).

import { eq, and, isNull } from "drizzle-orm";
import { getAreaZones } from "@/lib/areas";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { listCircles } from "@/lib/circles";
import { listJoinableCommunities } from "@/lib/communities";
import { PostReferralForm } from "./post-referral-form";

export const dynamic = "force-dynamic";

export default async function PostReferralPage({
  searchParams,
}: {
  searchParams: Promise<{ refer?: string }>;
}) {
  const { refer } = await searchParams;
  const userId = await getVerifiedUserId();
  const db = await getDb();
  const [zones, circles, communities, prefillRow] = await Promise.all([
    getAreaZones(),
    userId ? listCircles(db, userId) : Promise.resolve([]),
    userId ? listJoinableCommunities(db, userId) : Promise.resolve([]),
    refer && userId && refer !== userId
      ? db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(and(eq(users.id, refer), eq(users.accountType, "therapist"), isNull(users.deletedAt)))
      : Promise.resolve([]),
  ]);
  const prefillTherapist = prefillRow[0] ? { id: prefillRow[0].id, displayName: prefillRow[0].displayName ?? "this therapist" } : undefined;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Post a referral</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Only structured fields and your patient summary are shared with matched therapists — never
        their name, phone number, or exact address.
      </p>
      <div className="mt-6">
        <PostReferralForm zones={zones} circles={circles} communities={communities.filter((c) => c.isMember)} prefillTherapist={prefillTherapist} />
      </div>
    </main>
  );
}
