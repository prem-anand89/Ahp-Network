// Profile Card addendum — the therapist's own "you" view. Home
// (/app/dashboard, "Network Activity") stays what's happening around a
// therapist; this is what's true about them: the public card as others
// see it, verification/credential status, Circles in place, and edit
// entry points. §0's default-visible / "Show full profile" split applies
// here the same as on the public card, since this renders the identical
// data.

import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { users, homeVisitAreas, areas } from "@/db/schema";
import { listCircles } from "@/lib/circles";
import { listDisplayCredentials, listDisplayCourses, listDisplayExperience } from "@/lib/profile-card";
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
} from "@/components/badges/verification-badge";
import { AvailabilityToggle } from "@/components/availability-toggle";
import { AvailabilityFreshness } from "@/components/availability-freshness";
import { Button } from "@/components/ui/button";
import { ShowFullProfile } from "./show-full-profile";
import {
  ROLE_NEEDED_LABELS,
  SPECIALIZATION_LABELS,
  AGE_GROUP_LABELS,
} from "@/lib/referral-labels";

export const dynamic = "force-dynamic";

export default async function OwnProfilePage() {
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const db = await getDb();

  const [meRows, areaRows, circles, credentials, courses, experience] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)),
    db
      .select({
        name: areas.name,
        isPrimary: homeVisitAreas.isPrimary,
      })
      .from(homeVisitAreas)
      .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
      .where(and(eq(homeVisitAreas.userId, userId), isNull(homeVisitAreas.deletedAt)))
      .orderBy(desc(homeVisitAreas.isPrimary)),
    listCircles(db, userId),
    listDisplayCredentials(db, userId),
    listDisplayCourses(db, userId),
    listDisplayExperience(db, userId),
  ]);

  const [me] = meRows;
  if (!me) return null;

  const primaryArea = areaRows.find((a) => a.isPrimary) ?? areaRows[0];
  const otherAreas = areaRows.filter((a) => a !== primaryArea);

  // §9: past entries stay behind the "Show full profile" tap alongside
  // current ones once there's more than one total — not tiered by timing.
  const showAllExperienceByDefault = experience.length <= 1;

  const memberships = [...credentials.statutoryRegistrations, ...credentials.professionalAssociations];

  const experienceSection = experience.length > 0 && (
    <section>
      <h2 className="text-sm font-semibold text-muted-foreground">Experience</h2>
      <ul className="mt-2 flex flex-col gap-2 text-sm">
        {experience.map((e) => (
          <li key={e.id}>
            <span className="font-medium">{e.practiceName}</span>
            {e.displayTitle ? ` — ${e.displayTitle}` : ""}
            {e.isCurrent && <span className="ml-2 text-xs text-muted-foreground">Current</span>}
            {e.googlePlaceId ? (
              <a
                href={`https://www.google.com/maps/place/?q=place_id:${e.googlePlaceId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-xs text-muted-foreground hover:underline"
              >
                View Location Map
              </a>
            ) : e.formattedAddress ? (
              <a
                href={`https://www.google.com/maps/search/?q=${encodeURIComponent(e.formattedAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-xs text-muted-foreground hover:underline"
              >
                Unclaimed listing — search map
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{me.displayName ?? "Your profile"}</h1>
          {me.role && <p className="text-muted-foreground">{ROLE_NEEDED_LABELS[me.role] ?? me.role}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {me.verificationStage === "credentials_verified" && <CredentialsVerifiedBadge dateLabel="" />}
          {me.verificationStage === "qualification_confirmed" && <QualificationConfirmedBadge dateLabel="" />}
        </div>
      </div>

      <div className="mt-3">
        <AvailabilityToggle initialAvailable={me.availableForNewPatients} />
        <AvailabilityFreshness
          availableForNewPatients={me.availableForNewPatients}
          availabilityUpdatedAt={me.availabilityUpdatedAt}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {me.slug && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/pt/${me.slug}`} prefetch={false}>View public profile</Link>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href="/app/onboarding" prefetch={false}>Edit profile</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/verification" prefetch={false}>Verification status</Link>
        </Button>
      </div>

      {(me.specializations.length > 0 || me.ageGroupsServed.length > 0) && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Clinical Practice Focus</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {me.specializations.map((s) => (
              <span key={s} className="rounded-full border px-2.5 py-1 text-xs">
                {SPECIALIZATION_LABELS[s] ?? s}
              </span>
            ))}
            {me.ageGroupsServed.map((a) => (
              <span key={a} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                {AGE_GROUP_LABELS[a] ?? a}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* §5: Memberships & Registrations — text-only Statutory vs.
          Professional Association distinction, never a checkmark on
          either. §5/finding 4: an explicit state when there are zero
          approved registrations, not a silently missing section, since a
          therapist mid-verification at qualification_confirmed genuinely
          has none yet. */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-muted-foreground">Memberships &amp; Registrations</h2>
        {memberships.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Registration pending review.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {credentials.statutoryRegistrations.map((r) => (
              <li key={r.id}>
                {r.councilName}
                {r.registrationNumber ? ` — ${r.registrationNumber}` : ""}
                <span className="ml-2 text-xs text-muted-foreground">Statutory</span>
              </li>
            ))}
            {credentials.professionalAssociations.map((r) => (
              <li key={r.id}>
                {r.councilName}
                <span className="ml-2 text-xs text-muted-foreground">Professional Association</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAllExperienceByDefault && experienceSection}

      {credentials.degrees.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Degrees &amp; Academic Credentials</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {credentials.degrees.map((d) => (
              <li key={d.id}>
                {d.type === "postgraduate_degree" ? "Postgraduate" : "Graduation"}
                {d.institutionName ? ` — ${d.institutionName}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {courses.certified.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Certifications &amp; Advanced Training</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {courses.certified.map((c) => (
              <li key={c.id}>Certified {c.name}</li>
            ))}
          </ul>
        </section>
      )}

      {(me.yearsExperience || me.teleRehabAvailable || me.acceptsHomeVisits || me.acceptsClinicVisits) && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Quick Facts</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            {me.yearsExperience != null && <li>{me.yearsExperience} yrs experience</li>}
            {(me.acceptsHomeVisits || me.acceptsClinicVisits) && (
              <li>
                {[me.acceptsHomeVisits && "Home visits", me.acceptsClinicVisits && "Clinic visits"]
                  .filter(Boolean)
                  .join(" + ")}
              </li>
            )}
            {me.teleRehabAvailable && <li>Tele-rehab available</li>}
          </ul>
        </section>
      )}

      {primaryArea && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">Home-Visit Areas</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {primaryArea.name}
            {otherAreas.length > 0 && ` (+${otherAreas.length} more)`}
          </p>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-muted-foreground">Circles</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Private, named lists of therapists you want to remember — visible only to you.
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {circles.length === 0 && <p className="text-sm text-muted-foreground">No circles yet.</p>}
          {circles.map((c) => (
            <Link key={c.id} href={`/app/circles/${c.id}`} prefetch={false} className="text-sm hover:underline">
              {c.name} <span className="text-xs text-muted-foreground">({c.memberCount})</span>
            </Link>
          ))}
        </div>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link href="/app/circles" prefetch={false}>Manage circles</Link>
        </Button>
      </section>

      <div className="mt-8">
        <ShowFullProfile>
          <div className="flex flex-col gap-8">
            {courses.advancedTraining.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground">Advanced Training</h2>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {courses.advancedTraining.map((c) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
                </ul>
              </section>
            )}

            {courses.coursesWorkshops.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground">Courses &amp; Workshops</h2>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {courses.coursesWorkshops.map((c) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
                </ul>
              </section>
            )}

            {!showAllExperienceByDefault && experienceSection}

            {otherAreas.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground">All Home-Visit Areas</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {[primaryArea, ...otherAreas].filter(Boolean).map((a) => a!.name).join(", ")}
                </p>
              </section>
            )}

            {me.bio && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground">Bio</h2>
                <p className="mt-2 text-sm text-card-foreground">{me.bio}</p>
              </section>
            )}
          </div>
        </ShowFullProfile>
      </div>
    </main>
  );
}
