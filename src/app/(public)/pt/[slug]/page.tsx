// §9 — the public therapist profile. schema.org/Person markup, reveal-on-
// tap contact (never in initial markup — see RevealContactButton), OG
// image shared via opengraph-image.tsx in this same route segment (§10F).

import { and, eq, isNull, max } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/db";
import { users, credentials, homeVisitAreas, areas } from "@/db/schema";
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
} from "@/components/badges/verification-badge";
import { RevealContactButton } from "@/components/reveal-contact-button";
import { Card } from "@/components/ui/card";
import { AddToCircleButton } from "./add-to-circle-button";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS, AGE_GROUP_LABELS, timeAgoLabel } from "@/lib/referral-labels";
import { computeAvailabilityDisplay } from "@/lib/availability";
import { SITE_METADATA } from "@/lib/site-metadata";
import { listDisplayCredentials, listDisplayCourses, listDisplayExperience } from "@/lib/profile-card";
import { ShowFullProfile } from "@/components/show-full-profile";

// Deliberately dynamic, not a silent leak: getDb() needs the Hyperdrive
// binding from the live Worker request context, which doesn't exist at
// build time — so any route touching the database is inherently
// server-rendered per request on this stack, regardless of whether it
// reads cookies()/headers(). (An earlier `revalidate` export here was
// wrong — Next still rendered this route fully dynamic despite it, since
// the binding dependency forces that either way.) See the equivalent note
// in /directory/page.tsx and scripts/check-public-routes-static.mjs.
export const dynamic = "force-dynamic";

async function getProfile(slug: string) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.slug, slug),
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
        eq(users.profileVisibility, "public"),
        isNull(users.deletedAt),
      ),
    );
  if (!profile) return null;

  const [{ verifiedSince } = { verifiedSince: null }] = await db
    .select({ verifiedSince: max(credentials.verifiedAt) })
    .from(credentials)
    .where(and(eq(credentials.userId, profile.id), eq(credentials.status, "approved")));

  const areaRows = await db
    .select({ name: areas.name })
    .from(homeVisitAreas)
    .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .where(and(eq(homeVisitAreas.userId, profile.id), isNull(homeVisitAreas.deletedAt)));

  return { profile, verifiedSince, areaNames: areaRows.map((a) => a.name) };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getProfile(slug);
  if (!data) {
    return { title: "Profile not found" };
  }

  const roleLabel = data.profile.role
    ? (ROLE_NEEDED_LABELS[data.profile.role] ?? data.profile.role)
    : "Allied Health Professional";
  const displayName = data.profile.displayName ?? "Therapist";

  return {
    title: `${displayName} — ${roleLabel}`,
    description:
      data.profile.bio ??
      `${displayName} is a ${roleLabel} on ${SITE_METADATA.name}. View their verified public profile.`,
  };
}

export default async function TherapistProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [data, viewerUserId] = await Promise.all([getProfile(slug), getVerifiedUserId()]);
  if (!data) notFound();

  const { profile, verifiedSince, areaNames } = data;

  const db = await getDb();
  const [credentialsDisplay, courses, experience] = await Promise.all([
    listDisplayCredentials(db, profile.id),
    listDisplayCourses(db, profile.id),
    listDisplayExperience(db, profile.id),
  ]);
  const memberships = [...credentialsDisplay.statutoryRegistrations, ...credentialsDisplay.professionalAssociations];
  const showContact = profile.contactPreference !== "none" && Boolean(profile.publicContactValue);
  // §8E2 — never on your own profile; adding yourself to your own private
  // list isn't a real action this button needs to offer.
  const showAddToCircle = Boolean(viewerUserId) && viewerUserId !== profile.id;
  const verifiedSinceLabel = verifiedSince
    ? new Date(verifiedSince).toLocaleDateString("en-IN", { year: "numeric", month: "long" })
    : "";
  // §9: past entries stay behind "Show full profile" alongside current
  // ones once there's more than one total — not tiered by timing. Same
  // rule /app/profile/page.tsx applies to its own copy of this list.
  const showAllExperienceByDefault = experience.length <= 1;

  const experienceSection = experience.length > 0 && (
    <section>
      <h2 className="text-sm font-semibold">Experience</h2>
      <ul className="mt-1 flex flex-col gap-2 text-sm">
        {experience.map((e) => {
          // §11 — googlePlaceId decides which map-link treatment renders;
          // claimStatus decides the "Unclaimed listing" label. The two are
          // independent: a Places-matched practice can still be unclaimed.
          // Every row here necessarily has a real `practices` row
          // (practice_users.practice_id is NOT NULL), so the addendum's
          // third case — "no matching practices row at all, plain text,
          // nothing clickable" — never actually occurs for entries this
          // query returns; the dedup flow is exactly what stands in for
          // that case already.
          const isUnclaimed = e.claimStatus !== "claimed";
          return (
            <li key={e.id}>
              <span className="font-medium">{e.practiceName}</span>
              {e.displayTitle ? ` — ${e.displayTitle}` : ""}
              {e.isCurrent && <span className="ml-2 text-xs text-muted-foreground">Current</span>}
              {isUnclaimed && (
                <span className="ml-2 text-xs text-muted-foreground">Unclaimed listing — not verified</span>
              )}
              <div>
                {e.googlePlaceId ? (
                  <a
                    href={`https://www.google.com/maps/place/?q=place_id:${e.googlePlaceId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-card-foreground"
                  >
                    View Location Map
                  </a>
                ) : (
                  e.formattedAddress && (
                    // Styled distinctly from the place_id link above
                    // (dotted, no persistent underline) — a search link,
                    // not a verified pin, and must never read like one.
                    <a
                      href={`https://www.google.com/maps/search/?q=${encodeURIComponent(e.formattedAddress)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground italic decoration-dotted underline-offset-2 hover:underline"
                    >
                      Search map for this address
                    </a>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const schemaOrg = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.displayName,
    jobTitle: profile.role ? ROLE_NEEDED_LABELS[profile.role] : undefined,
    description: profile.bio ?? undefined,
  };

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-10">
      {/* schema.org JSON-LD, not user-controlled HTML */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaOrg) }}
      />

      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
            {profile.role && (
              <p className="text-muted-foreground">{ROLE_NEEDED_LABELS[profile.role] ?? profile.role}</p>
            )}
          </div>
          {showAddToCircle && <AddToCircleButton therapistUserId={profile.id} />}
        </div>

        {profile.verificationStage === "credentials_verified" && (
          <div className="flex items-center gap-3">
            <CredentialsVerifiedBadge dateLabel={verifiedSinceLabel} />
            <Link href={`/pt/${slug}/verification`} className="text-xs font-semibold text-primary hover:underline">
              View verification record →
            </Link>
          </div>
        )}
        {profile.verificationStage === "qualification_confirmed" && (
          <div className="flex items-center gap-3">
            <QualificationConfirmedBadge dateLabel={verifiedSinceLabel} />
            <Link href={`/pt/${slug}/verification`} className="text-xs font-semibold text-primary hover:underline">
              View verification record →
            </Link>
          </div>
        )}

        {(() => {
          // Profile Card addendum §2/finding 4 — four real states, not a
          // boolean dot: "not stated" (never touched) reads differently
          // from "not accepting" (an explicit answer), and colour is used
          // here for nothing else on this card, unlike the old version of
          // this block, which reused the verification badge's own colour
          // token for an unrelated signal.
          const availability = computeAvailabilityDisplay(
            profile.availableForNewPatients,
            profile.availabilityUpdatedAt,
          );
          if (availability.kind === "not_stated") return null;
          const label =
            availability.kind === "available_fresh" || availability.kind === "available_stale"
              ? "Available for new patients"
              : "Not accepting new patients right now";
          return (
            <div className="text-sm font-medium text-card-foreground">
              {label} — updated {timeAgoLabel(availability.updatedAt)}
            </div>
          );
        })()}
      </div>

      {/*
        §1/§2 — two columns above sm, single column (stacked) below it.
        `order-1`/`order-2` (rather than plain DOM order) puts the CTA
        column FIRST in both layouts: on mobile there's no true "right
        column" for it to live in, so it renders as the first block under
        the header instead of buried below Bio/Memberships/Experience.
        `items-start` is required — grid items stretch to the row's full
        height by default, which would silently break `sticky` on the CTA
        (its containing block would have no room to move within).

        Phase 3 rebuild: adds Clinical Practice Focus, Degrees,
        Certifications & Advanced Training, Quick Facts, and the "Show
        full profile" progressive-disclosure split, matching
        /app/profile/page.tsx's own structure exactly — profile-card.ts's
        own header comment says both consume the same addendum spec, so
        they should read the same way, not diverge.
      */}
      <div className="mt-8 grid gap-8 sm:grid-cols-[1fr_320px] sm:items-start">
        <div className="order-2 flex flex-col gap-8 sm:order-1">
          {(profile.specializations.length > 0 || profile.ageGroupsServed.length > 0) && (
            <section>
              <h2 className="text-sm font-semibold">Clinical Practice Focus</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.specializations.map((s) => (
                  <span key={s} className="rounded-full border px-2.5 py-1 text-xs">
                    {SPECIALIZATION_LABELS[s] ?? s}
                  </span>
                ))}
                {profile.ageGroupsServed.map((a) => (
                  <span key={a} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                    {AGE_GROUP_LABELS[a] ?? a}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* §5 / finding 4 — an explicit state when there are zero approved
              registrations (e.g. a therapist mid-verification at
              qualification_confirmed), never a silently missing section. */}
          <section>
            <h2 className="text-sm font-semibold">Memberships &amp; Registrations</h2>
            {memberships.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Registration pending review.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {credentialsDisplay.statutoryRegistrations.map((r) => (
                  <li key={r.id}>
                    {r.councilName}
                    {r.registrationNumber ? ` — ${r.registrationNumber}` : ""}
                    <span className="ml-2 text-xs text-muted-foreground">Statutory</span>
                  </li>
                ))}
                {credentialsDisplay.professionalAssociations.map((r) => (
                  <li key={r.id}>
                    {r.councilName}
                    <span className="ml-2 text-xs text-muted-foreground">Professional Association</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showAllExperienceByDefault && experienceSection}

          {credentialsDisplay.degrees.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold">Degrees &amp; Academic Credentials</h2>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {credentialsDisplay.degrees.map((d) => (
                  <li key={d.id}>
                    {d.type === "postgraduate_degree" ? "Postgraduate" : "Graduation"}
                    {d.institutionName ? ` — ${d.institutionName}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {courses.certified.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold">Certifications &amp; Advanced Training</h2>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {courses.certified.map((c) => (
                  <li key={c.id}>Certified {c.name}</li>
                ))}
              </ul>
            </section>
          )}

          {(profile.yearsExperience != null || profile.teleRehabAvailable || profile.acceptsHomeVisits || profile.acceptsClinicVisits) && (
            <section>
              <h2 className="text-sm font-semibold">Quick Facts</h2>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
                {profile.yearsExperience != null && <li>{profile.yearsExperience} yrs experience</li>}
                {(profile.acceptsHomeVisits || profile.acceptsClinicVisits) && (
                  <li>
                    {[profile.acceptsHomeVisits && "Home visits", profile.acceptsClinicVisits && "Clinic visits"]
                      .filter(Boolean)
                      .join(" + ")}
                  </li>
                )}
                {profile.teleRehabAvailable && <li>Tele-rehab available</li>}
              </ul>
            </section>
          )}

          <ShowFullProfile>
            <div className="flex flex-col gap-8">
              {courses.advancedTraining.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold">Advanced Training</h2>
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {courses.advancedTraining.map((c) => (
                      <li key={c.id}>{c.name}</li>
                    ))}
                  </ul>
                </section>
              )}

              {courses.coursesWorkshops.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold">Courses &amp; Workshops</h2>
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {courses.coursesWorkshops.map((c) => (
                      <li key={c.id}>{c.name}</li>
                    ))}
                  </ul>
                </section>
              )}

              {!showAllExperienceByDefault && experienceSection}

              {profile.bio && (
                <section>
                  <h2 className="text-sm font-semibold">Bio</h2>
                  <p className="mt-1 text-sm text-card-foreground">{profile.bio}</p>
                </section>
              )}
            </div>
          </ShowFullProfile>
        </div>

        <div className="order-1 flex flex-col gap-6 sm:order-2">
          {/* §2 — the CTA leads the right column, sticky on scroll, above
              everything else in it. `top-24` clears SiteNav, which floats
              sticky at top-4 and is itself roughly 64px tall — stacking
              this at top-6 would slide it in behind the nav instead of
              below it. */}
          {showContact && (
            <Card className="sticky top-24 block p-4">
              <h2 className="text-sm font-semibold">Contact</h2>
              <div className="mt-2">
                <RevealContactButton profileUserId={profile.id} />
              </div>
            </Card>
          )}

          {areaNames.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold">Home-visit areas</h2>
              <p className="mt-1 text-sm text-muted-foreground">{areaNames.join(", ")}</p>
            </section>
          )}

          {profile.languages && profile.languages.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold">Languages</h2>
              <p className="mt-1 text-sm text-muted-foreground">{profile.languages.join(", ")}</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
