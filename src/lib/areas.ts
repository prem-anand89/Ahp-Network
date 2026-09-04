// §6 — the curated areas tree. Fetched once, server-side, and handed to the
// client selector as plain data (BUILD_SEQUENCE.md Phase 2's "zero network
// calls" requirement) — the selector itself never fetches.

import { eq } from "drizzle-orm";
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

/** All active areas, grouped by zone for the selector's grouped-chip layout. */
export async function getAreaZones(): Promise<AreaZone[]> {
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
    .where(eq(areas.isActive, true));

  const zones = rows.filter((r): r is AreaNode & { areaLevel: "zone" } => r.areaLevel === "zone");
  const localities = rows.filter((r) => r.areaLevel === "locality");

  return zones
    .map((zone) => ({
      zone,
      localities: localities.filter((l) => l.parentId === zone.id),
    }))
    .sort((a, b) => a.zone.name.localeCompare(b.zone.name));
}
