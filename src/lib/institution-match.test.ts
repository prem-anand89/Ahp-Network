// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention.
//
// Verifies the check-then-insert race fix: two concurrent submissions
// naming the same not-yet-curated institution must produce exactly one
// pending_review row, not two.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { matchOrQueueInstitution, normalizeInstitutionName } from "./institution-match";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";

const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdInstitutionIds: string[] = [];

afterEach(async () => {
  let id: string | undefined;
  while ((id = createdInstitutionIds.pop()) !== undefined) {
    await client`DELETE FROM master_institutions WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await client.end();
});

describe("matchOrQueueInstitution — concurrent curation-queue insert", () => {
  it("inserts exactly one pending_review row for two simultaneous unmatched submissions", async () => {
    const rawName = `Concurrency Test Institute ${Date.now()}`;

    const [first, second] = await Promise.all([
      matchOrQueueInstitution(db, rawName, "Hyderabad"),
      matchOrQueueInstitution(db, rawName, "Hyderabad"),
    ]);

    createdInstitutionIds.push(first.institutionId!, second.institutionId!);

    expect(first.institutionId).toBe(second.institutionId);
    expect([first.enteredCurationQueue, second.enteredCurationQueue].filter(Boolean)).toHaveLength(1);

    const normalized = normalizeInstitutionName(rawName);
    const rows = await client`
      SELECT id FROM master_institutions WHERE normalized_name = ${normalized}`;
    expect(rows).toHaveLength(1);
  });
});
