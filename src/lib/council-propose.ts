// Round 3 step B — "My council isn't listed," on the credential-upload
// form's council_registration path. Same discipline as
// institution-match.ts's matchOrQueueInstitution: never auto-approved,
// CLAUDE.md's "master_councils is hand-curated... anything beyond the
// pilot seed goes through the same pending_review curation queue as
// institutions." Unlike institutions, master_councils has no
// normalized_name/pg_trgm search infrastructure — a case-insensitive
// exact match on (name, state) is enough here: it's a short, slow-
// growing list (one row per state's statutory body, not per-institution),
// so an admin merging an occasional near-duplicate in the curation queue
// is cheaper than building fuzzy-match infra for a handful of rows a year.

import { and, eq, sql } from "drizzle-orm";
import { masterCouncils } from "@/db/schema";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface ProposeCouncilResult {
  councilId: string;
  /** True only when this call actually inserted a new pending_review row —
   * false when an existing row (any curation status) already matched. */
  enteredCurationQueue: boolean;
}

/**
 * `state` is required — this path exists specifically for a state whose
 * statutory council isn't curated yet (pledge-options.ts's whole reason
 * for existing); a national body would already be one of the 3 pilot
 * seed rows. Always inserted as `statutory_registration`: this form only
 * appears for a "council / statutory registration" credential, never a
 * professional-association one.
 */
export async function proposeCouncilTx(db: Db, name: string, state: string): Promise<ProposeCouncilResult> {
  const trimmedName = name.trim();
  const trimmedState = state.trim();
  if (!trimmedName) throw new Error("Name the council or registration body.");
  if (!trimmedState) throw new Error("Which state is this council for?");

  // A transaction-scoped advisory lock keyed on (name, state), same
  // pattern as matchOrQueueInstitution — two therapists from the same
  // uncurated state proposing the same council in the same window
  // (plausible right after a new city unlocks) would otherwise both miss
  // a case-insensitive match and both insert a row for it. The two-key
  // form of pg_advisory_xact_lock (rather than hashtext(name || state))
  // avoids concatenating with a separator that could collide (or, as a
  // literal \0, simply isn't valid in a Postgres text parameter at all).
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${trimmedName.toLowerCase()}), hashtext(${trimmedState.toLowerCase()}))`,
    );

    const [existing] = await tx
      .select({ id: masterCouncils.id })
      .from(masterCouncils)
      .where(
        and(
          sql`lower(${masterCouncils.name}) = lower(${trimmedName})`,
          sql`lower(${masterCouncils.state}) = lower(${trimmedState})`,
        ),
      );
    if (existing) {
      return { councilId: existing.id, enteredCurationQueue: false };
    }

    const [created] = await tx
      .insert(masterCouncils)
      .values({
        name: trimmedName,
        councilType: "statutory_registration",
        state: trimmedState,
        curationStatus: "pending_review",
      })
      .returning({ id: masterCouncils.id });

    return { councilId: created.id, enteredCurationQueue: true };
  });
}

/** For binding a freshly-proposed council into the picker without a
 * page reload — the therapist's own submission still shows the real
 * name they typed, with a "pending review" note (copy.ts), not a bare id. */
export async function getCouncilName(db: Db, councilId: string): Promise<string | null> {
  const [row] = await db.select({ name: masterCouncils.name }).from(masterCouncils).where(eq(masterCouncils.id, councilId));
  return row?.name ?? null;
}
