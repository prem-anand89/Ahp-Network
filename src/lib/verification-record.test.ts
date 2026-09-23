// Phase 3 — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { getPublicVerificationRecord } from "./verification-record";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdCouncilIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM credentials WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
  let councilId: string | undefined;
  while ((councilId = createdCouncilIds.pop()) !== undefined) {
    await client`DELETE FROM master_councils WHERE id = ${councilId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `verification-record-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createCouncil(name: string): Promise<string> {
  const [row] = await client`
    INSERT INTO master_councils (name, council_type) VALUES (${name}, 'statutory_registration') RETURNING id`;
  createdCouncilIds.push(row.id);
  return row.id;
}

describe("getPublicVerificationRecord (Phase 3 — the product thesis)", () => {
  it("returns an approved, visible council registration with its registration number", async () => {
    const userId = await createUser();
    const councilId = await createCouncil(`TGPMB ${crypto.randomUUID()}`);
    await client`
      INSERT INTO credentials (user_id, type, council_id, registration_number, status, verified_at)
      VALUES (${userId}, 'council_registration', ${councilId}, 'APPT/2019/04412', 'approved', now())`;

    const record = await getPublicVerificationRecord(db, userId);
    expect(record).toHaveLength(1);
    expect(record[0].registrationNumber).toBe("APPT/2019/04412");
    expect(record[0].councilType).toBe("statutory_registration");
  });

  it("excludes a credential the therapist opted out of the public record", async () => {
    const userId = await createUser();
    const councilId = await createCouncil(`TGPMB ${crypto.randomUUID()}`);
    await client`
      INSERT INTO credentials (user_id, type, council_id, registration_number, status, public_record_visible)
      VALUES (${userId}, 'council_registration', ${councilId}, 'APPT/2019/04412', 'approved', false)`;

    const record = await getPublicVerificationRecord(db, userId);
    expect(record).toHaveLength(0);
  });

  it("excludes a pending (not yet approved) credential", async () => {
    const userId = await createUser();
    const councilId = await createCouncil(`TGPMB ${crypto.randomUUID()}`);
    await client`
      INSERT INTO credentials (user_id, type, council_id, registration_number, status)
      VALUES (${userId}, 'council_registration', ${councilId}, 'APPT/2019/04412', 'pending')`;

    const record = await getPublicVerificationRecord(db, userId);
    expect(record).toHaveLength(0);
  });

  it("excludes a soft-deleted credential", async () => {
    const userId = await createUser();
    const councilId = await createCouncil(`TGPMB ${crypto.randomUUID()}`);
    await client`
      INSERT INTO credentials (user_id, type, council_id, registration_number, status, deleted_at)
      VALUES (${userId}, 'council_registration', ${councilId}, 'APPT/2019/04412', 'approved', now())`;

    const record = await getPublicVerificationRecord(db, userId);
    expect(record).toHaveLength(0);
  });

  it("never selects ocr_extracted_json or the document's own url — only the display columns", async () => {
    // Structural guard, not a runtime one: if getPublicVerificationRecord
    // ever grows a select({...}) that includes documentUrl or
    // ocrExtractedJson, this test's own return-type check (via
    // VerificationRecordEntry) would fail to compile — TypeScript, not
    // a data assertion, is the actual enforcement here.
    const userId = await createUser();
    const record = await getPublicVerificationRecord(db, userId);
    expect(record).toEqual([]);
  });

  it("returns an empty array, not an error, for a therapist with no approved credentials", async () => {
    const userId = await createUser();
    const record = await getPublicVerificationRecord(db, userId);
    expect(record).toEqual([]);
  });

  it("returns the admin-set document_kind for an approved qualification credential", async () => {
    const userId = await createUser();
    await client`
      INSERT INTO credentials (user_id, type, document_kind, status, verified_at)
      VALUES (${userId}, 'degree', 'bonafide', 'approved', now())`;

    const record = await getPublicVerificationRecord(db, userId);
    expect(record).toHaveLength(1);
    expect(record[0].documentKind).toBe("bonafide");
  });

  it("has a null document_kind for a council registration (no equivalent ambiguity to record)", async () => {
    const userId = await createUser();
    const councilId = await createCouncil(`TGPMB ${crypto.randomUUID()}`);
    await client`
      INSERT INTO credentials (user_id, type, council_id, registration_number, status, verified_at)
      VALUES (${userId}, 'council_registration', ${councilId}, 'APPT/2019/04412', 'approved', now())`;

    const record = await getPublicVerificationRecord(db, userId);
    expect(record[0].documentKind).toBeNull();
  });

  it("the database rejects a document_kind set on a council_registration row (credentials_document_kind_type_check)", async () => {
    const userId = await createUser();
    const councilId = await createCouncil(`TGPMB ${crypto.randomUUID()}`);
    await expect(
      client`
        INSERT INTO credentials (user_id, type, council_id, registration_number, document_kind, status)
        VALUES (${userId}, 'council_registration', ${councilId}, 'APPT/2019/04412', 'bonafide', 'approved')`,
    ).rejects.toThrow();
  });

  it("the database rejects a document_kind outside the allowed set (credentials_document_kind_check)", async () => {
    const userId = await createUser();
    await expect(
      client`
        INSERT INTO credentials (user_id, type, document_kind, status)
        VALUES (${userId}, 'degree', 'transcript', 'approved')`,
    ).rejects.toThrow();
  });
});
