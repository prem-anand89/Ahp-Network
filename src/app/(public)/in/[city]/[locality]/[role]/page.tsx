// Phase 3 — role-scoped locality landing page ("physiotherapist in
// Kondapur"), the actual search-intent match the plain locality page
// (../page.tsx) can only approximate. Same resolver, same searchDirectory
// call, with the role filter applied — no new sort logic.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { getDb } from "@/db/db";
import { resolveLocality, localityRoleLabel, type LocalityRoleSlug } from "@/lib/locality-pages";
import { searchDirectory } from "@/lib/directory";
import { ProfileCard } from "@/components/cards/profile-card";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { SITE_METADATA } from "@/lib/site-metadata";
import { directoryResultsLine, localityContextLine } from "@/lib/copy";
import { getVerifiedUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageParams {
  city: string;
  locality: string;
  role: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { city, locality, role } = await params;
  const roleLabel = localityRoleLabel(role);
  if (!roleLabel) return {};

  const db = await getDb();
  const resolved = await resolveLocality(db, city, locality);
  if (!resolved) return {};

  const title = `${roleLabel}s in ${resolved.locality.name}, ${resolved.city.name}`;
  const description = `Verified ${roleLabel.toLowerCase()}s in ${resolved.locality.name} — each profile reviewed by an AHP Network admin against a document, not by algorithm.`;
  return {
    title,
    description,
    openGraph: {
      title: `${title} | ${SITE_METADATA.name}`,
      description,
      url: `${SITE_METADATA.url}/in/${resolved.city.slug}/${resolved.locality.slug}/${role}`,
      siteName: SITE_METADATA.name,
      type: "website",
    },
  };
}

export default async function LocalityRolePage({ params }: { params: Promise<PageParams> }) {
  const { city, locality, role } = await params;
  const roleLabel = localityRoleLabel(role);
  if (!roleLabel) notFound();

  const db = await getDb();
  const resolved = await resolveLocality(db, city, locality);
  if (!resolved) notFound();

  const [profiles, viewerUserId] = await Promise.all([
    searchDirectory(db, {
      areaId: resolved.locality.id,
      role: role as LocalityRoleSlug,
    }),
    getVerifiedUserId(),
  ]);

  // §10 SEO — see ../page.tsx's comment on why `position` is deliberately
  // omitted (the underlying sort's random tiebreak, per §1A).
  const itemListSchema =
    profiles.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: profiles.map((profile) => ({
            "@type": "ListItem",
            item: {
              "@type": "Person",
              name: profile.displayName,
              url: `${SITE_METADATA.url}/pt/${profile.slug}`,
            },
          })),
        }
      : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {itemListSchema && (
        <script
          type="application/ld+json"
          // schema.org JSON-LD, not user-controlled HTML
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
        />
      )}
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="size-4" aria-hidden />
        <a href={`/in/${resolved.city.slug}/${resolved.locality.slug}`} className="hover:underline">
          {resolved.locality.name}, {resolved.city.name}
        </a>
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        {roleLabel}s in {resolved.locality.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {localityContextLine(profiles.length, profiles.length === 0)}
      </p>

      <p className="mt-4 text-sm text-muted-foreground">
        {directoryResultsLine(profiles.length, roleLabel, resolved.locality.name)}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<MapPin className="size-6" aria-hidden />}
            title={`No verified ${roleLabel.toLowerCase()}s in ${resolved.locality.name} yet`}
            body="Browse the full directory instead, or check back as the founding cohort grows here."
            action={
              <a href="/directory" className="text-sm font-semibold hover:underline">
                Browse the full directory
              </a>
            }
          />
        )}
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            slug={profile.slug}
            displayName={profile.displayName}
            photoUrl={profile.photoUrl}
            role={profile.role}
            specializations={profile.specializations}
            verificationStage={profile.verificationStage}
            verifiedSinceLabel={
              profile.verifiedSince
                ? new Date(profile.verifiedSince).toLocaleDateString("en-IN", { year: "numeric", month: "long" })
                : undefined
            }
            localityLabel={profile.localityLabel ?? undefined}
            capacityState={profile.capacityState}
            availabilityUpdatedAt={profile.availabilityUpdatedAt}
            showAddToCircle={Boolean(viewerUserId) && viewerUserId !== profile.id}
            userId={profile.id}
          />
        ))}
      </div>
    </main>
  );
}
