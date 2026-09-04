// §8C3 — the public practice profile. schema.org/MedicalBusiness markup.
// Unclaimed-listing rules from §8C: no verification badge, explicit
// "Unclaimed listing" label, owner-only fields (services, specialties,
// equipment, phone, email, website) absent until claimed.

import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/db/db";
import { practices, practiceUsers, users } from "@/db/schema";
import { OwnershipVerifiedBadge } from "@/components/badges/verification-badge";

// ISR — see the equivalent note in /pt/[slug]/page.tsx.
export const revalidate = 3600;

// §8C: "noindex until claimed. No schema.org markup on unclaimed
// practices" — schema.org is additionally gated inline below.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPractice(slug);
  if (!data || data.practice.claimStatus === "claimed") return {};
  return { robots: { index: false, follow: false } };
}

async function getPractice(slug: string) {
  const db = await getDb();
  const [practice] = await db
    .select()
    .from(practices)
    .where(and(eq(practices.slug, slug), isNull(practices.deletedAt)));
  if (!practice) return null;

  const affiliated = await db
    .select({ displayName: users.displayName, slug: users.slug })
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
  const data = await getPractice(slug);
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

      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{practice.name}</h1>
          <p className="text-sm text-muted-foreground">{practice.formattedAddress}</p>
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

        {affiliated.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold">Affiliated therapists</h2>
            <ul className="text-sm text-muted-foreground">
              {affiliated.map((t) => (
                <li key={t.slug ?? t.displayName}>{t.displayName}</li>
              ))}
            </ul>
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
