// §8C3 — the public practice profile. schema.org/MedicalBusiness markup.
// Unclaimed-listing rules from §8C: no verification badge, explicit
// "Unclaimed listing" label, owner-only fields (services, specialties,
// equipment, phone, email, website) absent until claimed.

import { and, eq, isNull } from "drizzle-orm";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { getDb } from "@/db/db";
import { practices, practiceUsers, users } from "@/db/schema";
import { OwnershipVerifiedBadge } from "@/components/badges/verification-badge";
import { ProfileCard } from "@/components/cards/profile-card";
import { SITE_METADATA } from "@/lib/site-metadata";
import { getVerifiedUserId } from "@/lib/supabase/server";

// Deliberately dynamic — see the equivalent note in /pt/[slug]/page.tsx.
export const dynamic = "force-dynamic";

const PRACTICE_TYPE_LABELS: Record<string, string> = {
  clinic: "Clinic",
  hospital_department: "Hospital department",
  home_care_agency: "Home care agency",
  wellness_center: "Wellness center",
  other: "Practice",
};

// §8C: "noindex until claimed. No schema.org markup on unclaimed
// practices" — schema.org is additionally gated inline below.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPractice(slug);
  if (!data) return {};
  const { practice } = data;

  if (practice.claimStatus !== "claimed") {
    return { robots: { index: false, follow: false } };
  }

  const title = practice.name;
  const description = practice.bio
    ? practice.bio.slice(0, 155)
    : `${PRACTICE_TYPE_LABELS[practice.type] ?? "Practice"} on AHP Network — ownership verified, with affiliated verified therapists.`;

  return {
    title,
    description,
    openGraph: {
      title: `${title} | ${SITE_METADATA.name}`,
      description,
      url: `${SITE_METADATA.url}/clinic/${practice.slug}`,
      siteName: SITE_METADATA.name,
      type: "website",
    },
  };
}

async function getPractice(slug: string) {
  const db = await getDb();
  const [practice] = await db
    .select()
    .from(practices)
    .where(and(eq(practices.slug, slug), isNull(practices.deletedAt)));
  if (!practice) return null;

  const affiliated = await db
    .select({
      userId: users.id,
      slug: users.slug,
      displayName: users.displayName,
      photoUrl: users.photoUrl,
      role: users.role,
      specializations: users.specializations,
      verificationStage: users.verificationStage,
      capacityState: users.capacityState,
      availabilityUpdatedAt: users.availabilityUpdatedAt,
    })
    .from(practiceUsers)
    .innerJoin(users, eq(users.id, practiceUsers.userId))
    .where(
      and(
        eq(practiceUsers.practiceId, practice.id),
        eq(practiceUsers.consentStatus, "accepted"),
        eq(practiceUsers.isPublic, true),
        isNull(practiceUsers.endedAt),
        isNull(practiceUsers.deletedAt),
      ),
    );

  return { practice, affiliated };
}

export default async function PracticeProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [data, viewerUserId] = await Promise.all([getPractice(slug), getVerifiedUserId()]);
  if (!data) notFound();

  const { practice, affiliated } = data;
  const isClaimed = practice.claimStatus === "claimed";

  const schemaOrg = isClaimed
    ? {
        "@context": "https://schema.org",
        "@type": "MedicalBusiness",
        name: practice.name,
        address: practice.formattedAddress ?? undefined,
        telephone: practice.phone ?? undefined,
        url: practice.websiteUrl ?? undefined,
        image: practice.coverImageUrl ?? practice.logoUrl ?? undefined,
      }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {schemaOrg && (
        // schema.org JSON-LD, not user-controlled HTML
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaOrg) }}
        />
      )}

      {isClaimed && practice.coverImageUrl && (
        <div className="relative -mx-6 mb-4 h-40 overflow-hidden sm:rounded-card-lg sm:mx-0">
          <Image src={practice.coverImageUrl} alt="" fill unoptimized className="object-cover" />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          {isClaimed && practice.logoUrl ? (
            <Image
              src={practice.logoUrl}
              alt=""
              width={56}
              height={56}
              unoptimized
              className="size-14 shrink-0 rounded-card border bg-card object-cover"
            />
          ) : (
            <div className="flex size-14 shrink-0 items-center justify-center rounded-card border bg-muted text-muted-foreground">
              <Building2 className="size-6" aria-hidden />
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {PRACTICE_TYPE_LABELS[practice.type] ?? "Practice"}
            </p>
            <h1 className="text-2xl font-semibold">{practice.name}</h1>
            <p className="text-sm text-muted-foreground">{practice.formattedAddress}</p>
          </div>
        </div>

        {isClaimed ? (
          <OwnershipVerifiedBadge dateLabel={practice.claimedAt?.toLocaleDateString("en-IN") ?? ""} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Unclaimed listing — added by a therapist on AHP Network. Not verified.
          </p>
        )}

        {isClaimed && practice.bio && <p className="text-sm">{practice.bio}</p>}

        {isClaimed && (practice.servicesOffered?.length ?? 0) > 0 && (
          <div>
            <h2 className="text-sm font-semibold">Services offered</h2>
            <p className="text-sm text-muted-foreground">{practice.servicesOffered!.join(", ")}</p>
          </div>
        )}

        {isClaimed && (practice.specialties?.length ?? 0) > 0 && (
          <div>
            <h2 className="text-sm font-semibold">Specialties</h2>
            <p className="text-sm text-muted-foreground">{practice.specialties!.join(", ")}</p>
          </div>
        )}

        {affiliated.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-semibold">Affiliated therapists</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {affiliated.map((t) => (
                <ProfileCard
                  key={t.userId}
                  slug={t.slug}
                  displayName={t.displayName}
                  photoUrl={t.photoUrl}
                  role={t.role}
                  specializations={t.specializations}
                  verificationStage={t.verificationStage}
                  capacityState={t.capacityState}
                  availabilityUpdatedAt={t.availabilityUpdatedAt}
                  showAddToCircle={Boolean(viewerUserId) && viewerUserId !== t.userId}
                  userId={t.userId}
                />
              ))}
            </div>
          </div>
        )}

        {isClaimed && (practice.phone || practice.websiteUrl) && (
          <div>
            <h2 className="text-sm font-semibold">Contact</h2>
            {practice.phone && <p className="text-sm text-muted-foreground">{practice.phone}</p>}
            {practice.websiteUrl && (
              <a href={practice.websiteUrl} className="text-sm font-semibold hover:underline">
                {practice.websiteUrl}
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
