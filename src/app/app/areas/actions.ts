"use server";

// Round 3 step C — the national LocalityPicker/CityPicker's server-side
// calls. Thin wrappers, same DI-testable pattern as the rest of this
// codebase: the real logic lives in src/lib/area-search.ts (reads) and
// src/lib/area-propose.ts (the one write), both directly unit-tested
// against real Postgres.

import { getCityAreaTree, searchAreas, type AreaLevel } from "@/lib/area-search";
import { proposeLocalityTx } from "@/lib/area-propose";
import { requireAuthedTherapist } from "@/lib/require-session";

export async function searchAreasAction(query: string, opts?: { cityAreaId?: string; levels?: AreaLevel[] }) {
  const { db } = await requireAuthedTherapist();
  return searchAreas(db, query, opts ?? {});
}

export async function getCityAreaTreeAction(cityAreaId: string) {
  const { db } = await requireAuthedTherapist();
  return getCityAreaTree(db, cityAreaId);
}

export async function proposeLocalityAction(name: string, cityAreaId: string, zoneAreaId?: string) {
  const { db } = await requireAuthedTherapist();
  return proposeLocalityTx(db, name, cityAreaId, zoneAreaId);
}
