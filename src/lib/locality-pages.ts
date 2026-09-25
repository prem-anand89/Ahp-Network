// Phase 3 — locality landing pages (/in/[city]/[locality][/role]). Resolves
// the URL's two slugs against the hand-curated areas tree (src/lib/areas.ts
// serves the directory's selector off the same table, but that helper
// caches the whole zone tree for a form — this needs single-row lookups
// keyed by the two slugs actually in the URL, so it's a separate, smaller
// query rather than filtering the cached tree).

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { getDb } from "@/db/db";
import { areas, homeVisitAreas, users } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface ResolvedLocality {
  city: { id: string; name: string; slug: string };
  locality: { id: string; name: string; slug: string };
}

/** Returns null (caller does notFound()) if either slug doesn't resolve,
 * or the locality doesn't actually belong to that city — a locality slug
 * that happens to match under the wrong city must 404, not silently
 * render under a false city context.
 *
 * Round 3 — the locality lookup is scoped to the resolved city's
 * cityAreaId, not a bare global slug match: `areas_slug_unique_within_city`
 * (schema.ts) only guarantees a locality's slug is unique *within its own
 * city* ("gandhi-nagar" legitimately repeats across cities nationwide), so
 * an unscoped `eq(areas.slug, localitySlug)` could match a same-named
 * locality in a different city and then wrongly 404 (via the old
 * ancestorIds check) even though the right row exists. */
export async function resolveLocality(
  db: Db,
  citySlug: string,
  localitySlug: string,
): Promise<ResolvedLocality | null> {
  const [city] = await db
    .select({ id: areas.id, name: areas.name, slug: areas.slug })
    .from(areas)
    .where(and(eq(areas.slug, citySlug), eq(areas.areaLevel, "city"), eq(areas.isActive, true)));
  if (!city) return null;

  const [locality] = await db
    .select({ id: areas.id, name: areas.name, slug: areas.slug })
    .from(areas)
    .where(
      and(
        eq(areas.slug, localitySlug),
        eq(areas.areaLevel, "locality"),
        eq(areas.isActive, true),
        eq(areas.cityAreaId, city.id),
      ),
    );
  if (!locality) return null;

  return { city, locality: { id: locality.id, name: locality.name, slug: locality.slug } };
}

// Round 3 step F — thin-content guard (plan §6): the India Post loader
// can add ~150k localities nationwide, and almost all of them will have
// no therapist covering them yet. A sitemap entry for every single one
// would be both a crawl-budget and a thin-content problem, so a locality
// only qualifies once at least this many listed, public, verified
// therapists actually cover it.
export const LOCALITY_SITEMAP_MIN_THERAPISTS = 3;

export interface SitemapLocality {
  citySlug: string;
  localitySlug: string;
}

/** Localities worth a sitemap entry — covered by at least
 * LOCALITY_SITEMAP_MIN_THERAPISTS listed, public, verified therapists,
 * counting a primary home_visit_areas row at the locality itself OR at a
 * zone/city above it (the same "covers this locality or an area above
 * it" containment rule matching already applies via ancestor_ids — a
 * therapist who ticked "whole zone" covers every locality in it). Never
 * pulls every active area nationwide into memory; only the qualifying
 * rows are selected. */
export async function getSitemapEligibleLocalities(db: Db): Promise<SitemapLocality[]> {
  const city = alias(areas, "city");
  const rows = await db
    .select({
      localitySlug: areas.slug,
      citySlug: city.slug,
    })
    .from(areas)
    .innerJoin(city, eq(city.id, areas.cityAreaId))
    .innerJoin(
      homeVisitAreas,
      and(
        eq(homeVisitAreas.tier, "primary"),
        isNull(homeVisitAreas.deletedAt),
        sql`${homeVisitAreas.areaId} = ${areas.id} OR ${homeVisitAreas.areaId} = ANY(${areas.ancestorIds})`,
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, homeVisitAreas.userId),
        eq(users.accountType, "therapist"),
        eq(users.profileStatus, "active"),
        eq(users.profileVisibility, "public"),
        isNull(users.deletedAt),
        ne(users.verificationStage, "unverified"),
      ),
    )
    .where(and(eq(areas.areaLevel, "locality"), eq(areas.isActive, true)))
    .groupBy(areas.id, areas.slug, city.slug)
    .having(sql`count(distinct ${users.id}) >= ${LOCALITY_SITEMAP_MIN_THERAPISTS}`);

  return rows;
}

export const LOCALITY_ROLE_OPTIONS = [
  { value: "physiotherapist", label: "Physiotherapist" },
  { value: "occupational_therapist", label: "Occupational Therapist" },
  { value: "speech_language_pathologist", label: "Speech-Language Pathologist" },
] as const;

export type LocalityRoleSlug = (typeof LOCALITY_ROLE_OPTIONS)[number]["value"];

export function localityRoleLabel(roleSlug: string): string | null {
  return LOCALITY_ROLE_OPTIONS.find((o) => o.value === roleSlug)?.label ?? null;
}
