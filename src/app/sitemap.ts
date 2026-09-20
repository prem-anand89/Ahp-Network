// Phase 1 step 13 — sitemap.ts didn't exist. Dynamic (needs getDb() for
// the per-profile URLs, unavailable at build time — same reasoning as
// (public)/pt/[slug]/opengraph-image.tsx). Sitemap crawls are infrequent
// (daily at most for a real crawler), so this is a negligible addition to
// Hyperdrive's query budget, unlike a page a visitor loads.
//
// Practice/clinic URLs are deliberately not included yet — /clinic/[slug]
// doesn't exist as a real product surface until Phase 3.

import type { MetadataRoute } from "next";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db/db";
import { users } from "@/db/schema";
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

  return [...staticRoutes, ...profileRoutes, ...verificationRoutes];
}
