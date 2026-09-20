// Phase 1 step 13 — sitemap.ts didn't exist. Dynamic (needs getDb() for
// the per-profile URLs, unavailable at build time — same reasoning as
// (public)/pt/[slug]/opengraph-image.tsx). Sitemap crawls are infrequent
// (daily at most for a real crawler), so this is a negligible addition to
// Hyperdrive's query budget, unlike a page a visitor loads.

import type { MetadataRoute } from "next";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users, areas, practices } from "@/db/schema";
import { SITE_METADATA } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = await getDb();
  const profiles = await db
    .select({ slug: users.slug, updatedAt: users.updatedAt })
    .from(users)
    .where(
      and(
        eq(users.accountType, "therapist"),
        isNull(users.deletedAt),
        ne(users.verificationStage, "unverified"),
      ),
    );

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_METADATA.url, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_METADATA.url}/directory`, changeFrequency: "daily", priority: 0.9 },
  ];

  const verifiedProfiles = profiles.filter(
    (profile): profile is { slug: string; updatedAt: Date } => Boolean(profile.slug),
  );

  const profileRoutes: MetadataRoute.Sitemap = verifiedProfiles.map((profile) => ({
    url: `${SITE_METADATA.url}/pt/${profile.slug}`,
    lastModified: profile.updatedAt,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // Phase 3 — the Public Verification Record, "the product thesis,"
  // gets its own indexable URL per the plan. Same profile set as above
  // (every one already has verificationStage != 'unverified').
  const verificationRoutes: MetadataRoute.Sitemap = verifiedProfiles.map((profile) => ({
    url: `${SITE_METADATA.url}/pt/${profile.slug}/verification`,
    lastModified: profile.updatedAt,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  // Phase 3 — locality landing pages. Base locality URLs only, not the
  // per-role variants: those are combinatorial (locality × 3 roles) and
  // the plain locality page already links to each one, so a crawler
  // reaches them without every combination needing its own sitemap entry.
  const areaRows = await db
    .select({ id: areas.id, slug: areas.slug, areaLevel: areas.areaLevel, ancestorIds: areas.ancestorIds })
    .from(areas)
    .where(eq(areas.isActive, true));
  const cities = areaRows.filter((a) => a.areaLevel === "city");
  const localityRoutes: MetadataRoute.Sitemap = areaRows
    .filter((a) => a.areaLevel === "locality")
    .flatMap((locality) => {
      const city = cities.find((c) => locality.ancestorIds.includes(c.id));
      if (!city) return [];
      return [
        {
          url: `${SITE_METADATA.url}/in/${city.slug}/${locality.slug}`,
          changeFrequency: "weekly" as const,
          priority: 0.6,
        },
      ];
    });

  // Phase 3 — practice profiles. Claimed only: page.tsx's own generateMetadata
  // sets robots noindex for an unclaimed listing, and practices.noindex
  // reflects the same fact — a sitemap entry for a page that says "don't
  // index me" would be self-contradictory.
  const claimedPractices = await db
    .select({ slug: practices.slug, updatedAt: practices.updatedAt })
    .from(practices)
    .where(and(eq(practices.claimStatus, "claimed"), isNull(practices.deletedAt)));
  const practiceRoutes: MetadataRoute.Sitemap = claimedPractices
    .filter((p): p is { slug: string; updatedAt: Date } => Boolean(p.slug))
    .map((p) => ({
      url: `${SITE_METADATA.url}/clinic/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));

  return [...staticRoutes, ...profileRoutes, ...verificationRoutes, ...localityRoutes, ...practiceRoutes];
}
