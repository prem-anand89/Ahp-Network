// Round 3 — national place registry. Pure, DB-free transform of the
// India Post "All India Pincode Directory" (data.gov.in, Department of
// Posts, Government Open Data License – India) into the shape the
// `areas` table needs: state → district (our "city") → taluk (our
// "zone") → locality.
//
// Confirmed CSV field names: OFFICENAME, TALUK, DISTRICTNAME, STATENAME,
// PINCODE, OFFICETYPE, DELIVERYSTATUS, DIVISIONNAME, REGIONNAME,
// CIRCLENAME. Only the first five are used — no lat/long exists in this
// dataset, consistent with the plan's names-only design.
//
// Kept separate from scripts/load-india-post-areas.ts (the DB-writing
// CLI) so this logic is testable with vitest against fixture CSV text,
// with no Postgres connection and no download — see
// india-post-loader.test.ts.

export interface IndiaPostRow {
  officeName: string;
  taluk: string;
  districtName: string;
  stateName: string;
  pincode: string;
}

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, commas and
 * escaped `""` inside quotes. The India Post export is well-formed, so
 * this doesn't need to handle every CSV edge case — just not choke on
 * office names that contain a comma (a handful do, e.g. "Rural, Block"
 * style names in some circles). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

const REQUIRED_HEADERS = ["officename", "taluk", "districtname", "statename", "pincode"];

/** Header-driven, so column order in the actual export doesn't matter and
 * a differently-cased header ("OfficeName" vs "OFFICENAME") still works. */
export function parseIndiaPostCsv(csvText: string): IndiaPostRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const colIndex: Record<string, number> = {};
  for (const h of REQUIRED_HEADERS) {
    const idx = header.indexOf(h);
    if (idx === -1) {
      throw new Error(`India Post CSV is missing required column "${h}" (found: ${header.join(", ")})`);
    }
    colIndex[h] = idx;
  }

  const rows: IndiaPostRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const officeName = cols[colIndex.officename]?.trim();
    const stateName = cols[colIndex.statename]?.trim();
    const districtName = cols[colIndex.districtname]?.trim();
    const pincode = cols[colIndex.pincode]?.trim();
    if (!officeName || !stateName || !districtName || !pincode) continue; // skip malformed rows rather than throw on one bad line in 150k
    rows.push({
      officeName,
      taluk: cols[colIndex.taluk]?.trim() || districtName, // some rows have no taluk; fall back to the district itself as the zone
      districtName,
      stateName,
      pincode,
    });
  }
  return rows;
}

const OFFICE_TYPE_SUFFIX = /\s+(S\.?O\.?|B\.?O\.?|H\.?O\.?)$/i;

/** "Kukatpally S.O" -> "Kukatpally". Deliberately regex-driven off the
 * office name itself rather than the separate OFFICETYPE column — every
 * office name in the dataset already carries this suffix, so one pass
 * covers it without needing a second field. */
export function normalizeLocalityName(officeName: string): string {
  return officeName.replace(OFFICE_TYPE_SUFFIX, "").trim();
}

export interface GroupedLocality {
  stateName: string;
  districtName: string;
  taluk: string;
  localityName: string;
  pincode: string;
}

/** Collapses "Kukatpally S.O" and "Kukatpally Colony B.O" — different
 * post offices, same normalized name only when the leftover text after
 * stripping the suffix is identical — down to one locality per
 * (state, district, taluk, normalized name). The first pincode seen for
 * a group wins; a locality keeps exactly one PIN for search purposes,
 * even though a large area may span several in reality. */
export function groupIndiaPostRows(rows: IndiaPostRow[]): GroupedLocality[] {
  const seen = new Map<string, GroupedLocality>();
  for (const row of rows) {
    const localityName = normalizeLocalityName(row.officeName);
    if (!localityName) continue;
    const key = [row.stateName, row.districtName, row.taluk, localityName].join("\u0000").toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { stateName: row.stateName, districtName: row.districtName, taluk: row.taluk, localityName, pincode: row.pincode });
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// DB-writing half — invoked once by scripts/load-india-post-areas.ts, and
// directly by tests (against real local Postgres, never mocked, per
// BUILD_SEQUENCE.md Phase 0's convention). Idempotent: a second run over
// the same grouped rows creates nothing new, since every level is found
// by its real uniqueness rule (slug scoped how areas_slug_unique_* scopes
// it) before it's inserted.
//
// Four straightforward, mostly-similar passes (state, city, zone,
// locality) rather than one generic parameterized function — an earlier
// draft tried to collapse them into one, and the result was hard to
// verify by reading it. This is a one-time offline load, not a live
// request path, so the CLAUDE.md referral-transaction rule doesn't apply;
// plain idempotent inserts are the right tool.
// ---------------------------------------------------------------------------

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { areas } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "area"
  );
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export interface LoadResult {
  statesCreated: number;
  citiesCreated: number;
  zonesCreated: number;
  localitiesCreated: number;
}

interface AreaRef {
  id: string;
  ancestorIds: string[];
}

/** States: the tree's root level, slug unique nationwide, no disambiguation needed —
 * India's 36 state/UT names don't collide with each other. */
async function upsertStates(db: Db, groupedRows: GroupedLocality[]): Promise<Map<string, AreaRef>> {
  const names = new Map<string, string>(); // lowercased -> display name
  for (const r of groupedRows) names.set(r.stateName.trim().toLowerCase(), toTitleCase(r.stateName.trim()));

  const toInsert = [...names.values()].map((name) => ({
    name,
    slug: slugify(name),
    areaLevel: "state" as const,
    ancestorIds: [],
    source: "india_post" as const,
  }));
  if (toInsert.length > 0) {
    await db.insert(areas).values(toInsert).onConflictDoNothing();
  }

  const rows = await db.select({ id: areas.id, name: areas.name, ancestorIds: areas.ancestorIds }).from(areas).where(eq(areas.areaLevel, "state"));
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), { id: r.id, ancestorIds: r.ancestorIds }]));

  const result = new Map<string, AreaRef>();
  for (const key of names.keys()) {
    const ref = byName.get(names.get(key)!.toLowerCase());
    if (ref) result.set(key, ref);
  }
  return result;
}

/** Cities: slug unique nationwide too (areas_slug_unique_top_level covers
 * state and city together), so a district name repeated across states —
 * "Aurangabad" exists in both Maharashtra and Bihar — needs a
 * state-qualified slug for every city sharing that name, not just the
 * second one seen. */
async function upsertCities(db: Db, groupedRows: GroupedLocality[], stateIds: Map<string, AreaRef>): Promise<Map<string, AreaRef>> {
  interface CityDraft {
    key: string; // state\0district, lowercased
    name: string;
    stateKey: string;
    stateRef: AreaRef;
  }
  const drafts = new Map<string, CityDraft>();
  for (const r of groupedRows) {
    const stateKey = r.stateName.trim().toLowerCase();
    const stateRef = stateIds.get(stateKey);
    if (!stateRef) continue; // shouldn't happen — every state was just upserted
    const key = `${stateKey}\u0000${r.districtName.trim().toLowerCase()}`;
    if (!drafts.has(key)) drafts.set(key, { key, name: toTitleCase(r.districtName.trim()), stateKey, stateRef });
  }

  const nameCounts = new Map<string, number>();
  for (const d of drafts.values()) nameCounts.set(slugify(d.name), (nameCounts.get(slugify(d.name)) ?? 0) + 1);

  const toInsert = [...drafts.values()].map((d) => {
    const baseSlug = slugify(d.name);
    const slug = (nameCounts.get(baseSlug) ?? 0) > 1 ? `${baseSlug}-${slugify(d.stateKey)}` : baseSlug;
    return {
      key: d.key,
      slug,
      values: {
        name: d.name,
        slug,
        areaLevel: "city" as const,
        parentId: d.stateRef.id,
        ancestorIds: [...d.stateRef.ancestorIds, d.stateRef.id],
        source: "india_post" as const,
      },
    };
  });

  if (toInsert.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db
        .insert(areas)
        .values(toInsert.slice(i, i + CHUNK).map((r) => r.values))
        .onConflictDoNothing();
    }
  }

  // A city is its own city_area_id — every city row still missing it
  // (freshly inserted, or a pre-Round-3 row like Hyderabad, reconciled by
  // migration 0051 already for the seed data but this covers any other
  // pre-existing city row too) gets it set to its own id. Idempotent: the
  // isNull guard excludes already-correct rows, so a re-run touches nothing.
  await db
    .update(areas)
    .set({ cityAreaId: sql`${areas.id}` })
    .where(and(eq(areas.areaLevel, "city"), isNull(areas.cityAreaId)));

  const rows = await db.select({ id: areas.id, slug: areas.slug, ancestorIds: areas.ancestorIds }).from(areas).where(eq(areas.areaLevel, "city"));
  const bySlug = new Map(rows.map((r) => [r.slug, { id: r.id, ancestorIds: r.ancestorIds }]));

  const result = new Map<string, AreaRef>();
  for (const { key, slug } of toInsert) {
    const ref = bySlug.get(slug);
    if (ref) result.set(key, ref);
  }
  return result;
}

/** Zones (taluks): slug unique only within its own city
 * (areas_slug_unique_within_city), so no cross-city disambiguation is
 * ever needed — two different cities can both have a "Central" taluk. */
async function upsertZones(db: Db, groupedRows: GroupedLocality[], cityIds: Map<string, AreaRef>): Promise<Map<string, AreaRef>> {
  interface ZoneDraft {
    key: string; // state\0district\0taluk, lowercased
    name: string;
    cityKey: string;
    cityRef: AreaRef;
  }
  const drafts = new Map<string, ZoneDraft>();
  for (const r of groupedRows) {
    const cityKey = `${r.stateName.trim().toLowerCase()}\u0000${r.districtName.trim().toLowerCase()}`;
    const cityRef = cityIds.get(cityKey);
    if (!cityRef) continue;
    const key = `${cityKey}\u0000${r.taluk.trim().toLowerCase()}`;
    if (!drafts.has(key)) drafts.set(key, { key, name: toTitleCase(r.taluk.trim()), cityKey, cityRef });
  }

  const toInsert = [...drafts.values()].map((d) => ({
    key: d.key,
    cityAreaId: d.cityRef.id,
    slug: slugify(d.name),
    values: {
      name: d.name,
      slug: slugify(d.name),
      areaLevel: "zone" as const,
      parentId: d.cityRef.id,
      cityAreaId: d.cityRef.id,
      ancestorIds: [...d.cityRef.ancestorIds, d.cityRef.id],
      source: "india_post" as const,
    },
  }));

  if (toInsert.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db
        .insert(areas)
        .values(toInsert.slice(i, i + CHUNK).map((r) => r.values))
        .onConflictDoNothing();
    }
  }

  const cityIdsInvolved = [...new Set(toInsert.map((r) => r.cityAreaId))];
  const rows =
    cityIdsInvolved.length > 0
      ? await db
          .select({ id: areas.id, slug: areas.slug, cityAreaId: areas.cityAreaId, ancestorIds: areas.ancestorIds })
          .from(areas)
          .where(and(eq(areas.areaLevel, "zone"), inArray(areas.cityAreaId, cityIdsInvolved)))
      : [];
  const byCityAndSlug = new Map(rows.map((r) => [`${r.cityAreaId}\u0000${r.slug}`, { id: r.id, ancestorIds: r.ancestorIds }]));

  const result = new Map<string, AreaRef>();
  for (const { key, cityAreaId, slug } of toInsert) {
    const ref = byCityAndSlug.get(`${cityAreaId}\u0000${slug}`);
    if (ref) result.set(key, ref);
  }
  return result;
}

/** Localities: same within-city uniqueness as zones. A locality's own
 * `city_area_id` is the city (not the zone) — matching how `home_visit_areas`
 * and referral matching read city scope directly off a locality row
 * without an extra hop through its zone. */
async function upsertLocalities(db: Db, groupedRows: GroupedLocality[], zoneIds: Map<string, AreaRef>): Promise<{ created: number }> {
  interface LocalityDraft {
    key: string;
    name: string;
    pincode: string;
    zoneRef: AreaRef;
  }
  const drafts = new Map<string, LocalityDraft>();
  for (const r of groupedRows) {
    const zoneKey = `${r.stateName.trim().toLowerCase()}\u0000${r.districtName.trim().toLowerCase()}\u0000${r.taluk.trim().toLowerCase()}`;
    const zoneRef = zoneIds.get(zoneKey);
    if (!zoneRef) continue;
    const key = `${zoneKey}\u0000${r.localityName.trim().toLowerCase()}`;
    if (!drafts.has(key)) drafts.set(key, { key, name: r.localityName, pincode: r.pincode, zoneRef });
  }

  // A zone's own ancestorIds is [state, city]; the city id is the last
  // element — this is how upsertZones built it (city.ancestorIds + [city]).
  const toInsert = [...drafts.values()].map((d) => {
    const cityAreaId = d.zoneRef.ancestorIds[d.zoneRef.ancestorIds.length - 1];
    return {
      cityAreaId,
      slug: slugify(d.name),
      values: {
        name: d.name,
        slug: slugify(d.name),
        areaLevel: "locality" as const,
        parentId: d.zoneRef.id,
        cityAreaId,
        ancestorIds: [...d.zoneRef.ancestorIds, d.zoneRef.id],
        pincode: d.pincode,
        source: "india_post" as const,
      },
    };
  });

  let created = 0;
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const inserted = await db
      .insert(areas)
      .values(toInsert.slice(i, i + CHUNK).map((r) => r.values))
      .onConflictDoNothing()
      .returning({ id: areas.id });
    created += inserted.length;
  }
  return { created };
}

/** Loads the whole tree in four passes (state, city, zone, locality),
 * each one bulk-inserted and re-queried before the next depends on it. */
export async function loadIndiaPostAreasTx(db: Db, groupedRows: GroupedLocality[]): Promise<LoadResult> {
  const [statesBefore, citiesBefore, zonesBefore, localitiesBefore] = await Promise.all([
    countByLevel(db, "state"),
    countByLevel(db, "city"),
    countByLevel(db, "zone"),
    countByLevel(db, "locality"),
  ]);

  const stateIds = await upsertStates(db, groupedRows);
  const cityIds = await upsertCities(db, groupedRows, stateIds);
  const zoneIds = await upsertZones(db, groupedRows, cityIds);
  await upsertLocalities(db, groupedRows, zoneIds);

  const [statesAfter, citiesAfter, zonesAfter, localitiesAfter] = await Promise.all([
    countByLevel(db, "state"),
    countByLevel(db, "city"),
    countByLevel(db, "zone"),
    countByLevel(db, "locality"),
  ]);

  return {
    statesCreated: statesAfter - statesBefore,
    citiesCreated: citiesAfter - citiesBefore,
    zonesCreated: zonesAfter - zonesBefore,
    localitiesCreated: localitiesAfter - localitiesBefore,
  };
}

async function countByLevel(db: Db, level: "state" | "city" | "zone" | "locality"): Promise<number> {
  const rows = await db.select({ id: areas.id }).from(areas).where(eq(areas.areaLevel, level));
  return rows.length;
}
