// Phase 3 — locality landing pages (/in/[city]/[locality][/role]). Resolves
// the URL's two slugs against the hand-curated areas tree (src/lib/areas.ts
// serves the directory's selector off the same table, but that helper
// caches the whole zone tree for a form — this needs single-row lookups
// keyed by the two slugs actually in the URL, so it's a separate, smaller
// query rather than filtering the cached tree).

import { and, eq } from "drizzle-orm";
import type { getDb } from "@/db/db";
import { areas } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface ResolvedLocality {
  city: { id: string; name: string; slug: string };
  locality: { id: string; name: string; slug: string };
}

/** Returns null (caller does notFound()) if either slug doesn't resolve,
 * or the locality doesn't actually belong to that city — a locality slug
 * that happens to match under the wrong city must 404, not silently
 * render under a false city context. */
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
    .select({ id: areas.id, name: areas.name, slug: areas.slug, ancestorIds: areas.ancestorIds })
    .from(areas)
    .where(and(eq(areas.slug, localitySlug), eq(areas.areaLevel, "locality"), eq(areas.isActive, true)));
  if (!locality || !locality.ancestorIds.includes(city.id)) return null;

  return { city, locality: { id: locality.id, name: locality.name, slug: locality.slug } };
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
