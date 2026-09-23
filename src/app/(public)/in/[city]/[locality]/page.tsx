// Phase 3 — locality landing page. The search intent is "physiotherapist
// in Kondapur" and no page in the app was about that before this. Reuses
// searchDirectory (src/lib/directory.ts) filtered to this locality's
// area id — same sort order, same verification-tier rule, nothing new.
//
// force-dynamic, not ISR — see the plan's reasoning (partitioned-snacking-
// panda.md, Phase 3): OpenNext-on-Workers ISR needs an incrementalCache
// AND a queue override neither of which open-next.config.ts has today,
// the page needs getDb() regardless so it's never truly static, and pilot
// SEO traffic is nowhere near Hyperdrive's 100k/day budget. The
// Cache-Control header for when a real edge cache rule exists is set in
// middleware.ts, scoped to this route — inert until the custom domain +
// Cloudflare Cache Rule land, harmless until then.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { getDb } from "@/db/db";
import { resolveLocality, LOCALITY_ROLE_OPTIONS } from "@/lib/locality-pages";
import { searchDirectory } from "@/lib/directory";
import { ProfileCard } from "@/components/cards/profile-card";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { SITE_METADATA } from "@/lib/site-metadata";
import { directoryResultsLine, localityContextLine } from "@/lib/copy";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { buildItemListSchema, jsonLdScript } from "@/lib/schema-org";

export const dynamic = "force-dynamic";

interface PageParams {
  city: string;
  locality: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { city, locality } = await params;
  const db = await getDb();
  const resolved = await resolveLocality(db, city, locality);
  if (!resolved) return {};

  const title = `Verified therapists in ${resolved.locality.name}, ${resolved.city.name}`;
  const description = `Physiotherapists, occupational therapists, and speech-language pathologists in ${resolved.locality.name}, verified by document, not by algorithm.`;
  return {
    title,
    description,
    openGraph: {
      title: `${title} | ${SITE_METADATA.name}`,
      description,
      url: `${SITE_METADATA.url}/in/${resolved.city.slug}/${resolved.locality.slug}`,
      siteName: SITE_METADATA.name,
      type: "website",
    },
  };
}

export default async function LocalityPage({ params }: { params: Promise<PageParams> }) {
  const { city, locality } = await params;
  const db = await getDb();
  const resolved = await resolveLocality(db, city, locality);
  if (!resolved) notFound();

  const [profiles, viewerUserId] = await Promise.all([
    searchDirectory(db, { areaId: resolved.locality.id }),
    getVerifiedUserId(),
  ]);

  // §10 SEO — ItemList markup naming the profiles this page lists.
  // Deliberately no `position` property: the underlying sort
  // (searchDirectory, src/lib/directory.ts) breaks ties with a random
  // shuffle by design (§1A — profiles are never ordered by a quality
  // measure), so a `position` here would assert an ordering claim the
  // data doesn't actually make and would churn on every request. An
  // unordered ItemList is still valid schema.org and still tells
  // crawlers what's on the page. buildItemListSchema also drops any
  // profile missing a slug/displayName (both nullable columns) rather
  // than emitting an invalid /pt/null URL or a null name.
  const itemListSchema = buildItemListSchema(profiles, SITE_METADATA.url);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {itemListSchema && (
        <script
          type="application/ld+json"
          // schema.org JSON-LD. Contains user-supplied displayName text,
          // so this goes through jsonLdScript() (escapes `<` so a name
          // containing "</script>" can't break out of this tag), not a
          // bare JSON.stringify.
          dangerouslySetInnerHTML={{ __html: jsonLdScript(itemListSchema) }}
        />
      )}
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <MapPin className="size-4" aria-hidden />
        {resolved.city.name}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Verified therapists in {resolved.locality.name}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {localityContextLine(profiles.length, profiles.length === 0)}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {LOCALITY_ROLE_OPTIONS.map((role) => (
          <a
            key={role.value}
            href={`/in/${resolved.city.slug}/${resolved.locality.slug}/${role.value}`}
            className="rounded-pill border border-graphite px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            {role.label} in {resolved.locality.name}
          </a>
        ))}
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        {directoryResultsLine(profiles.length, null, resolved.locality.name)}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<MapPin className="size-6" aria-hidden />}
            title={`No verified profiles in ${resolved.locality.name} yet`}
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
