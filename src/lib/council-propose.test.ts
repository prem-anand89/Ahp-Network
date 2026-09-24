// Round 3 step B — runs against real local Postgres, never mocks
// (BUILD_SEQUENCE.md Phase 0's test-stack convention).

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getCouncilName, proposeCouncilTx } from "./council-propose";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdCouncilIds: string[] = [];

afterEach(async () => {
  let id: string | undefined;
  while ((id = createdCouncilIds.pop()) !== undefined) {
    await client`DELETE FROM master_councils WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await client.end();
});

describe("proposeCouncilTx", () => {
  it("inserts a pending_review, statutory_registration row for a new (name, state) pair", async () => {
    const name = "Test Council " + crypto.randomUUID();
    const result = await proposeCouncilTx(db, name, "Test State");
    createdCouncilIds.push(result.councilId);

    expect(result.enteredCurationQueue).toBe(true);

    const [row] = await client`SELECT curation_status, council_type, state FROM master_councils WHERE id = ${result.councilId}`;
    expect(row.curation_status).toBe("pending_review");
    expect(row.council_type).toBe("statutory_registration");
    expect(row.state).toBe("Test State");
  });

  it("is case-insensitively idempotent for the same (name, state) pair", async () => {
    const name = "Test Idempotent Council " + crypto.randomUUID();
    const first = await proposeCouncilTx(db, name, "Test State");
    createdCouncilIds.push(first.councilId);

    const second = await proposeCouncilTx(db, name.toUpperCase(), "test state");
    expect(second.councilId).toBe(first.councilId);
    expect(second.enteredCurationQueue).toBe(false);

    const rows = await client`SELECT id FROM master_councils WHERE lower(name) = lower(${name})`;
    expect(rows).toHaveLength(1);
  });

  it("treats the same council name in two different states as two distinct rows", async () => {
    const name = "Test Shared Name Council " + crypto.randomUUID();
    const a = await proposeCouncilTx(db, name, "Test State A");
    const b = await proposeCouncilTx(db, name, "Test State B");
    createdCouncilIds.push(a.councilId, b.councilId);

    expect(a.councilId).not.toBe(b.councilId);
  });

  it("refuses a blank name or a blank state", async () => {
    await expect(proposeCouncilTx(db, "  ", "Test State")).rejects.toThrow(/name/i);
    await expect(proposeCouncilTx(db, "Test Council", "  ")).rejects.toThrow(/state/i);
  });

  it("two concurrent proposals for the same (name, state) produce exactly one row", async () => {
    const name = "Test Concurrent Council " + crypto.randomUUID();
    const [a, b] = await Promise.all([proposeCouncilTx(db, name, "Test State"), proposeCouncilTx(db, name, "Test State")]);
    createdCouncilIds.push(a.councilId);
    if (b.councilId !== a.councilId) createdCouncilIds.push(b.councilId);

    expect(a.councilId).toBe(b.councilId);
    const rows = await client`SELECT id FROM master_councils WHERE lower(name) = lower(${name})`;
    expect(rows).toHaveLength(1);
  });
});

describe("getCouncilName", () => {
  it("returns the name of an existing council", async () => {
    const name = "Test Named Council " + crypto.randomUUID();
    const { councilId } = await proposeCouncilTx(db, name, "Test State");
    createdCouncilIds.push(councilId);

    expect(await getCouncilName(db, councilId)).toBe(name);
  });

  it("returns null for a council that doesn't exist", async () => {
    expect(await getCouncilName(db, crypto.randomUUID())).toBeNull();
  });
});
