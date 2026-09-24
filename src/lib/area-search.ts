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
// src/lib/areas.ts's old getAreaZones (a full-tree, cached-client-side
// fetch) is now unused — Phase C's onboarding/profile-edit rewrite moved
// every call site onto searchAreas and getCityAreaTree below.

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
  /** Resolved alongside the label, so a caller (e.g. CityPicker resolving
   * a PIN match back to its city) never has to parse `label` to recover
   * the city's own name. Null only for a state-level result. */
  cityName: string | null;
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
  // A therapist-proposed locality still pending review doesn't show up
  // for anyone else's search — same discipline as Step 5's original
  // curation queue. The person who proposed it gets it back directly
  // from proposeLocalityTx's own return value, not by searching for it.
  const approvedFilter = eq(areas.curationStatus, "approved");

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
    .where(and(activeFilter, approvedFilter, matchCondition, levelFilter, cityFilter))
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
    // cityAreaId is always one of ancestorIds (a locality's chain is
    // [state, city, zone], a zone's is [state, city]), so nameById
    // already has it — no extra query needed.
    cityName: r.cityAreaId ? (nameById.get(r.cityAreaId) ?? null) : null,
    pincode: r.pincode,
    // ancestor_ids is ordered [state, city, zone?] — reversed so the
    // nearest containing place reads first, matching how an address is
    // normally said aloud ("Kukatpally, Hyderabad, Telangana").
    label: [r.name, ...[...r.ancestorIds].reverse().map((id) => nameById.get(id)).filter((n): n is string => !!n)].join(", "),
  }));
}

export interface CityAreaLocality {
  id: string;
  name: string;
  slug: string;
}

export interface CityAreaZone {
  id: string;
  name: string;
  slug: string;
  localities: CityAreaLocality[];
}

export interface CityAreaTree {
  cityId: string;
  cityName: string;
  zones: CityAreaZone[];
  /** Localities with no zone parent — a therapist-proposed locality
   * (area-propose.ts) added without picking a zone, or any other row
   * that predates the India Post loader's zone-per-locality shape. Kept
   * separate rather than dropped, so nothing a therapist already picked
   * silently disappears from their own coverage checklist. */
  unzoned: CityAreaLocality[];
}

/**
 * The whole zone/locality tree for one city, for the two-tier coverage
 * checklist (onboarding step 3, profile edit's "Where you work"). Not a
 * search — this is a bounded fetch (one city's own zones and localities,
 * a few dozen to a few hundred rows even for a large metro), unlike
 * searchAreas above which exists specifically because the *whole*
 * national tree can't be fetched at once.
 */
export async function getCityAreaTree(db: Db, cityAreaId: string): Promise<CityAreaTree> {
  const [city] = await db.select({ id: areas.id, name: areas.name }).from(areas).where(eq(areas.id, cityAreaId));
  if (!city) throw new Error("City not found.");

  const rows = await db
    .select({ id: areas.id, name: areas.name, slug: areas.slug, areaLevel: areas.areaLevel, parentId: areas.parentId })
    .from(areas)
    .where(and(eq(areas.cityAreaId, cityAreaId), eq(areas.isActive, true), eq(areas.curationStatus, "approved")));

  const zoneRows = rows.filter((r) => r.areaLevel === "zone").sort((a, b) => a.name.localeCompare(b.name));
  const localityRows = rows.filter((r) => r.areaLevel === "locality");
  const zoneIds = new Set(zoneRows.map((z) => z.id));

  const zones = zoneRows.map((z) => ({
    id: z.id,
    name: z.name,
    slug: z.slug,
    localities: localityRows
      .filter((l) => l.parentId === z.id)
      .map((l) => ({ id: l.id, name: l.name, slug: l.slug }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));

  const unzoned = localityRows
    .filter((l) => l.parentId === null || !zoneIds.has(l.parentId))
    .map((l) => ({ id: l.id, name: l.name, slug: l.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { cityId: city.id, cityName: city.name, zones, unzoned };
}
