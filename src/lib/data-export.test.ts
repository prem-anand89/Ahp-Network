// §8H data export — runs against a real local Postgres. R2 calls spied
// the same way as retention.test.ts/erasure.test.ts.

import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AwsClient } from "aws4fetch";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { requestDataExportTx } from "./data-export";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const testR2Env = {
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  R2_ACCESS_KEY_ID: "test-key",
  R2_SECRET_ACCESS_KEY: "test-secret",
};

const createdUserIds: string[] = [];
let lastPutBody: string | undefined;

beforeEach(() => {
  lastPutBody = undefined;
  vi.spyOn(AwsClient.prototype, "fetch").mockImplementation(async (input, init) => {
    const method = (init as RequestInit | undefined)?.method;
    if (method === "PUT") {
      lastPutBody = String((init as RequestInit).body);
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 204 });
  });
});

afterEach(async () => {
  vi.restoreAllMocks();

  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM notification_outbox WHERE user_id = ${userId}`;
    await client`DELETE FROM feedback WHERE user_id = ${userId}`;
    await client`DELETE FROM credentials WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `export-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("requestDataExportTx (§8H)", () => {
  it("uploads a JSON bundle to R2 and returns a download URL", async () => {
    const userId = await createUser();
    await client`INSERT INTO feedback (user_id, category, message) VALUES (${userId}, 'bug', 'a report to include in the export')`;

    const result = await requestDataExportTx(db, testR2Env, userId);

    expect(result.objectKey).toContain(`exports/${userId}/`);
    expect(result.downloadUrl).toContain("ahp-network-credentials");
    expect(lastPutBody).toBeDefined();

    const bundle = JSON.parse(lastPutBody!);
    expect(bundle.profile.id).toBe(userId);
    expect(bundle.feedback).toHaveLength(1);
    expect(bundle.feedback[0].message).toBeUndefined(); // message itself isn't selected, only metadata
  });

  it("enqueues an email notification carrying the download link", async () => {
    const userId = await createUser();

    const result = await requestDataExportTx(db, testR2Env, userId);

    const [row] = await client`SELECT channel, template, payload FROM notification_outbox WHERE user_id = ${userId}`;
    expect(row.channel).toBe("email");
    expect(row.template).toBe("data_export_ready");
    expect(row.payload.url).toBe(result.downloadUrl);
  });
});
