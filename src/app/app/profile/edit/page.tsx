// Phase 2 — the missing screen. /app/profile's "Edit profile" button and
// the dashboard checklist both used to point at /app/onboarding, which
// only ever writes displayName/role/slug/one area — neither can actually
// satisfy "add a photo" or "add 3 skills." This is where those go.

import { eq } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
import { ProfileEditForm } from "./profile-edit-form";

export const dynamic = "force-dynamic";

export default async function ProfileEditPage() {
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const db = await getDb();
  const [me] = await db.select().from(users).where(eq(users.id, userId));
  if (!me) return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Edit profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This is what shows up on your public profile and in the directory.
      </p>
      <div className="mt-6">
        <ProfileEditForm
          initial={{
            photoUrl: me.photoUrl,
            specializations: me.specializations,
            ageGroupsServed: me.ageGroupsServed,
            bio: me.bio ?? "",
            yearsExperience: me.yearsExperience,
            languages: me.languages ?? [],
            teleRehabAvailable: me.teleRehabAvailable,
            acceptsHomeVisits: me.acceptsHomeVisits,
            acceptsClinicVisits: me.acceptsClinicVisits,
          }}
        />
      </div>
    </main>
  );
}
