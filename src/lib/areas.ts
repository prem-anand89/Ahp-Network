// §6 — the curated areas tree. Fetched once per isolate, server-side, and
// handed to the client selector as plain data (BUILD_SEQUENCE.md Phase 2's
// "zero network calls" requirement) — the selector itself never fetches.

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/db";
import { areas } from "@/db/schema";

export interface AreaNode {
  id: string;
  name: string;
  slug: string;
  areaLevel: "city" | "zone" | "locality";
  parentId: string | null;
}

export interface AreaZone {
  zone: AreaNode;
  localities: AreaNode[];
}

let cachedZones: { zones: AreaZone[]; at: number } | undefined;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** All active, approved areas, grouped by zone for the selector's
 * grouped-chip layout. Step 5 [decision 11]: curationStatus = 'approved'
 * keeps a Places-fallback row pending admin review out of the shared
 * picker everyone else sees — the person who proposed it gets it
 * immediately via area-fallback-search.tsx's own return value instead. */
export async function getAreaZones(): Promise<AreaZone[]> {
  if (cachedZones && Date.now() - cachedZones.at < CACHE_TTL_MS) {
    return cachedZones.zones;
  }

  const db = await getDb();
  const rows = await db
    .select({
      id: areas.id,
      name: areas.name,
      slug: areas.slug,
      areaLevel: areas.areaLevel,
      parentId: areas.parentId,
    })
    .from(areas)
    .where(and(eq(areas.isActive, true), eq(areas.curationStatus, "approved")));

  const zones = rows.filter((r): r is AreaNode & { areaLevel: "zone" } => r.areaLevel === "zone");
  const localities = rows.filter((r) => r.areaLevel === "locality");

  const grouped = zones
    .map((zone) => ({
      zone,
      localities: localities.filter((l) => l.parentId === zone.id),
    }))
    .sort((a, b) => a.zone.name.localeCompare(b.zone.name));

  cachedZones = { zones: grouped, at: Date.now() };
  return grouped;
}
