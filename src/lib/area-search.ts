// Round 3 — national place search over the areas registry (India Post
// bulk load + hand-curated seed + therapist-typed proposals). Replaces
// the old chip-grid model (src/lib/areas.ts's getAreaZones, fetched once
// and cached client-side) now that the tree is national rather than one
// small hand-curated Hyderabad set — a full-tree fetch doesn't scale to
// ~150k localities, so this is a server-side typeahead instead.
//
// Zero external calls: everything here is our own `areas` table (pg_trgm
// already enabled, drizzle/0000), never Google — see the plan's "Where
// the place list comes from" section for why.
//
// Phase A only adds this function; the UI call sites (onboarding,
// referral form, directory, profile edit) are wired in during Phase C/F.
// src/lib/areas.ts's getAreaZones stays as-is (Hyderabad-only chip grid)
// until those call sites are actually rewritten, so nothing currently
// using it breaks mid-rollout.

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { areas } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export type AreaLevel = "state" | "city" | "zone" | "locality";

export interface AreaSearchResult {
  id: string;
  name: string;
  slug: string;
  areaLevel: AreaLevel;
  cityAreaId: string | null;
  pincode: string | null;
  /** "Kukatpally, Hyderabad, Telangana" — built from the ancestor chain,
   * so the same locality name from two different cities is never
   * ambiguous in a results list. */
  label: string;
}

const PINCODE_PATTERN = /^\d{6}$/;
const RESULT_LIMIT = 20;

/**
 * `opts.cityAreaId` restricts results to one city (used once a therapist
 * has already picked a city and is now searching localities within it).
 * `opts.levels` restricts which tree levels are searchable (e.g. a city
 * picker passes `['city']` so it never surfaces a bare locality match).
 * A bare 6-digit query is treated as a PIN lookup, exact match only, on
 * locality rows (the only level that carries one); anything else is a
 * name search — prefix match first (cheapest, most predictable), then
 * trigram similarity for a typo ("bengaluru" for "bengalooru").
 */
export async function searchAreas(
  db: Db,
  query: string,
  opts: { cityAreaId?: string; levels?: AreaLevel[] } = {},
): Promise<AreaSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const levelFilter = opts.levels ? inArray(areas.areaLevel, opts.levels) : undefined;
  const cityFilter = opts.cityAreaId ? eq(areas.cityAreaId, opts.cityAreaId) : undefined;
  const activeFilter = eq(areas.isActive, true);

  const matchCondition = PINCODE_PATTERN.test(trimmed)
    ? eq(areas.pincode, trimmed)
    : or(
        sql`lower(${areas.name}) LIKE lower(${trimmed + "%"})`,
        sql`lower(${areas.name}) % lower(${trimmed})`, // pg_trgm similarity operator
      );

  const rows = await db
    .select({
      id: areas.id,
      name: areas.name,
      slug: areas.slug,
      areaLevel: areas.areaLevel,
      cityAreaId: areas.cityAreaId,
      pincode: areas.pincode,
      ancestorIds: areas.ancestorIds,
    })
    .from(areas)
    .where(and(activeFilter, matchCondition, levelFilter, cityFilter))
    .orderBy(sql`similarity(lower(${areas.name}), lower(${trimmed})) DESC`)
    .limit(RESULT_LIMIT);

  if (rows.length === 0) return [];

  const ancestorIds = [...new Set(rows.flatMap((r) => r.ancestorIds))];
  const ancestorNames =
    ancestorIds.length > 0
      ? await db.select({ id: areas.id, name: areas.name }).from(areas).where(inArray(areas.id, ancestorIds))
      : [];
  const nameById = new Map(ancestorNames.map((a) => [a.id, a.name]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    areaLevel: r.areaLevel as AreaLevel,
    cityAreaId: r.cityAreaId,
    pincode: r.pincode,
    // ancestor_ids is ordered [state, city, zone?] — reversed so the
    // nearest containing place reads first, matching how an address is
    // normally said aloud ("Kukatpally, Hyderabad, Telangana").
    label: [r.name, ...[...r.ancestorIds].reverse().map((id) => nameById.get(id)).filter((n): n is string => !!n)].join(", "),
  }));
}
