// Round 3 step C — the "Where you work" write path for profile edit.
// completeProfileStep2Tx (onboarding.ts) is onboarding's one-time insert;
// this is the general-purpose replace, reused by profile edit whenever a
// therapist changes their coverage after onboarding — there was
// previously no write path for home_visit_areas outside onboarding.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { areas, homeVisitAreas } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface CoverageRow {
  cityAreaId: string;
  areaId: string;
  tier: "primary" | "secondary";
}

/**
 * Soft-deletes every active home_visit_areas row for the therapist and
 * inserts the new set — simpler and just as correct as a diff/patch for
 * a checklist this size (a few dozen rows at most), and it avoids the
 * `home_visit_areas_one_primary` partial unique index ever seeing two
 * `is_primary` rows at once mid-update (the old row is gone before the
 * new one is inserted).
 */
export async function replaceCoverageTx(db: Db, userId: string, baseAreaId: string, coverage: CoverageRow[]): Promise<void> {
  const rows = coverage.length > 0 ? coverage : [{ cityAreaId: baseAreaId, areaId: baseAreaId, tier: "primary" as const }];

  await db.transaction(async (tx) => {
    await tx
      .update(homeVisitAreas)
      .set({ deletedAt: new Date() })
      .where(and(eq(homeVisitAreas.userId, userId), isNull(homeVisitAreas.deletedAt)));

    await tx.insert(homeVisitAreas).values(
      rows.map((r) => ({
        userId,
        areaId: r.areaId,
        tier: r.tier,
        isPrimary: r.areaId === baseAreaId ? true : undefined,
      })),
    );
  });
}

export interface MyCoverage {
  baseAreaId: string | null;
  cities: { id: string; name: string }[];
  coverage: CoverageRow[];
}

/**
 * Reconstructs the AreaCoveragePicker's initial state from stored rows —
 * each row's own city comes from `areas.city_area_id`, so no second
 * lookup table is needed to group rows by city.
 */
export async function getMyCoverageTx(db: Db, userId: string): Promise<MyCoverage> {
  const rows = await db
    .select({
      areaId: homeVisitAreas.areaId,
      tier: homeVisitAreas.tier,
      isPrimary: homeVisitAreas.isPrimary,
      cityAreaId: areas.cityAreaId,
    })
    .from(homeVisitAreas)
    .innerJoin(areas, eq(areas.id, homeVisitAreas.areaId))
    .where(and(eq(homeVisitAreas.userId, userId), isNull(homeVisitAreas.deletedAt)));

  if (rows.length === 0) return { baseAreaId: null, cities: [], coverage: [] };

  const cityAreaIds = [...new Set(rows.map((r) => r.cityAreaId).filter((id): id is string => !!id))];
  // Each row's own `areas.name` above is the covered area's own name, not
  // its city's — resolve city display names with a separate batched
  // lookup keyed by the distinct city_area_ids.
  const cityRows = cityAreaIds.length > 0 ? await db.select({ id: areas.id, name: areas.name }).from(areas).where(inArray(areas.id, cityAreaIds)) : [];

  const cityNameById = new Map(cityRows.map((c) => [c.id, c.name]));
  const cities = cityAreaIds.map((id) => ({ id, name: cityNameById.get(id) ?? "" }));
  const baseAreaId = rows.find((r) => r.isPrimary)?.areaId ?? null;
  const coverage = rows
    .filter((r): r is typeof r & { cityAreaId: string } => !!r.cityAreaId)
    .map((r) => ({ cityAreaId: r.cityAreaId, areaId: r.areaId, tier: r.tier as "primary" | "secondary" }));

  return { baseAreaId, cities, coverage };
}
