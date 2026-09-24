// Round 3 step C — "My locality isn't listed," replacing Step 5's Google
// Places fallback now that the registry is India Post-sourced (a real
// gap is expected to be rare with national coverage, but a hyperlocal
// name or a brand-new development can still miss it). Same discipline as
// council-propose.ts: never auto-approved, a case-insensitive dedupe
// scoped to the city (not the whole country — two different cities can
// each have their own real "Gandhi Nagar"), and a transaction-scoped
// advisory lock so two therapists proposing the same missing locality in
// the same window land on one row, not two.

import { and, eq, sql } from "drizzle-orm";
import { areas } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "locality"
  );
}

export interface ProposedLocality {
  id: string;
  name: string;
}

/**
 * `zoneAreaId`, when given, must be a zone belonging to `cityAreaId` — the
 * new locality is filed under it, same as any India Post-loaded one.
 * Without it, the locality is filed directly under the city (no zone),
 * surfaced separately by getCityAreaTree's `unzoned` list rather than
 * silently dropped.
 */
export async function proposeLocalityTx(
  db: Db,
  name: string,
  cityAreaId: string,
  zoneAreaId?: string,
): Promise<ProposedLocality> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Name the locality you're proposing.");

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${trimmedName.toLowerCase()}), hashtext(${cityAreaId}))`,
    );

    const [existing] = await tx
      .select({ id: areas.id, name: areas.name })
      .from(areas)
      .where(
        and(
          eq(areas.cityAreaId, cityAreaId),
          eq(areas.areaLevel, "locality"),
          sql`lower(${areas.name}) = lower(${trimmedName})`,
        ),
      );
    if (existing) return existing;

    const [parent] = zoneAreaId
      ? await tx
          .select({ id: areas.id, ancestorIds: areas.ancestorIds })
          .from(areas)
          .where(and(eq(areas.id, zoneAreaId), eq(areas.cityAreaId, cityAreaId), eq(areas.areaLevel, "zone")))
      : await tx.select({ id: areas.id, ancestorIds: areas.ancestorIds }).from(areas).where(eq(areas.id, cityAreaId));
    if (!parent) throw new Error("Couldn't place that locality — try again.");

    const baseSlug = slugify(trimmedName);
    let slug = baseSlug;
    for (let attempt = 1; ; attempt++) {
      const [conflict] = await tx
        .select({ id: areas.id })
        .from(areas)
        .where(and(eq(areas.cityAreaId, cityAreaId), eq(areas.slug, slug)));
      if (!conflict) break;
      slug = `${baseSlug}-${attempt + 1}`;
    }

    const [created] = await tx
      .insert(areas)
      .values({
        name: trimmedName,
        slug,
        areaLevel: "locality",
        parentId: parent.id,
        cityAreaId,
        ancestorIds: [...parent.ancestorIds, parent.id],
        curationStatus: "pending_review",
        source: "therapist_added",
      })
      .returning({ id: areas.id, name: areas.name });

    return created;
  });
}
