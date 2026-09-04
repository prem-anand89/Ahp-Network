// §9 — the public therapist profile. schema.org/Person markup, reveal-on-
// tap contact (never in initial markup — see RevealContactButton), OG
// image shared via opengraph-image.tsx in this same route segment (§10F).

import { and, eq, isNull, max } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/db";
import { users, credentials, homeVisitAreas, areas } from "@/db/schema";
import {
  CredentialsVerifiedBadge,
  QualificationConfirmedBadge,
} from "@/components/badges/verification-badge";
import { RevealContactButton } from "@/components/reveal-contact-button";

// Deliberately dynamic, not a silent leak: getDb() needs the Hyperdrive
// binding from the live Worker request context, which doesn't exist at
// build time — so any route touching the database is inherently
// server-rendered per request on this stack, regardless of whether it
// reads cookies()/headers(). (An earlier `revalidate` export here was
// wrong — Next still rendered this route fully dynamic despite it, since
// the binding dependency forces that either way.) See the equivalent note
// in /directory/page.tsx and scripts/check-public-routes-static.mjs.
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  physiotherapist: "Physiotherapist",
  occupational_therapist: "Occupational Therapist",
  speech_language_pathologist: "Speech-Language Pathologist",
};

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

export default async function TherapistProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getProfile(slug);
  if (!data) notFound();

  const { profile, verifiedSince, areaNames } = data;
  const verifiedSinceLabel = verifiedSince
    ? new Date(verifiedSince).toLocaleDateString("en-IN", { year: "numeric", month: "long" })
    : "";

  const schemaOrg = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.displayName,
    jobTitle: profile.role ? ROLE_LABELS[profile.role] : undefined,
    description: profile.bio ?? undefined,
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {/* schema.org JSON-LD, not user-controlled HTML */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaOrg) }}
      />

      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
          {profile.role && <p className="text-muted-foreground">{ROLE_LABELS[profile.role]}</p>}
        </div>

        {profile.verificationStage === "credentials_verified" && (
          <CredentialsVerifiedBadge dateLabel={verifiedSinceLabel} />
        )}
        {profile.verificationStage === "qualification_confirmed" && (
          <QualificationConfirmedBadge dateLabel={verifiedSinceLabel} />
        )}

        {profile.bio && <p className="text-sm text-card-foreground">{profile.bio}</p>}

        {areaNames.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold">Home-visit areas</h2>
            <p className="text-sm text-muted-foreground">{areaNames.join(", ")}</p>
          </div>
        )}

        {profile.languages && profile.languages.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold">Languages</h2>
            <p className="text-sm text-muted-foreground">{profile.languages.join(", ")}</p>
          </div>
        )}

        {profile.availableForNewPatients && (
          <div className="flex items-center gap-1.5 text-sm font-medium text-[color:var(--color-verified)]">
            <span className="size-1.5 rounded-full bg-[color:var(--color-verified)]" aria-hidden />
            Available for new patients
          </div>
        )}

        {profile.contactPreference !== "none" && Boolean(profile.publicContactValue) && (
          <div>
            <h2 className="text-sm font-semibold">Contact</h2>
            <RevealContactButton profileUserId={profile.id} />
          </div>
        )}
      </div>
    </main>
  );
}
