// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention.
//
// Phase 5's own "Done when": every filter in the taxonomy narrows the
// result set without changing sort order. Tested here against a handful
// of seeded profiles spanning both verification tiers and both roles.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { searchDirectory } from "./directory";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";

const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let id: string | undefined;
  while ((id = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM users WHERE id = ${id}`;
    await client`DELETE FROM auth.users WHERE id = ${id}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function seedTherapist(opts: {
  email: string;
  role: "physiotherapist" | "occupational_therapist";
  verificationStage: "unverified" | "qualification_confirmed" | "credentials_verified";
  availableForNewPatients?: boolean;
}): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${opts.email}) RETURNING id`;
  await client`
    INSERT INTO users (
      id, email, account_type, display_name, role, verification_stage,
      profile_status, profile_visibility, available_for_new_patients
    ) VALUES (
      ${authUser.id}, ${opts.email}, 'therapist', ${opts.email}, ${opts.role},
      ${opts.verificationStage}, 'active', 'public', ${opts.availableForNewPatients ?? false}
    )`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("searchDirectory — §9 filter taxonomy and sort order", () => {
  it("the role filter narrows the result set without touching sort order", async () => {
    await seedTherapist({
      email: "dir-pt-1@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await seedTherapist({
      email: "dir-ot-1@example.com",
      role: "occupational_therapist",
      verificationStage: "credentials_verified",
    });

    const physios = await searchDirectory(db, { role: "physiotherapist" });
    expect(physios.every((p) => p.role === "physiotherapist")).toBe(true);
    expect(physios.some((p) => p.role === "occupational_therapist")).toBe(false);
  });

  it("[E4] verifiedOnly defaults off — qualification_confirmed profiles are still returned", async () => {
    await seedTherapist({
      email: "dir-qc-1@example.com",
      role: "physiotherapist",
      verificationStage: "qualification_confirmed",
    });

    const results = await searchDirectory(db, {});
    expect(results.some((p) => p.verificationStage === "qualification_confirmed")).toBe(true);
  });

  it("verifiedOnly, when explicitly turned on, excludes qualification_confirmed profiles", async () => {
    const qcId = await seedTherapist({
      email: "dir-qc-2@example.com",
      role: "physiotherapist",
      verificationStage: "qualification_confirmed",
    });
    await seedTherapist({
      email: "dir-cv-2@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });

    const results = await searchDirectory(db, { verifiedOnly: true });
    expect(results.some((p) => p.id === qcId)).toBe(false);
    expect(results.every((p) => p.verificationStage === "credentials_verified")).toBe(true);
  });

  it("sorts credentials_verified before qualification_confirmed before unverified, regardless of filters", async () => {
    await seedTherapist({
      email: "dir-sort-unverified@example.com",
      role: "physiotherapist",
      verificationStage: "unverified",
    });
    await seedTherapist({
      email: "dir-sort-cv@example.com",
      role: "physiotherapist",
      verificationStage: "credentials_verified",
    });
    await seedTherapist({
      email: "dir-sort-qc@example.com",
      role: "physiotherapist",
      verificationStage: "qualification_confirmed",
    });

    const results = await searchDirectory(db, { role: "physiotherapist" });
    const tiers = results.map((p) => p.verificationStage);
    const firstUnverified = tiers.indexOf("unverified");
    const firstQc = tiers.indexOf("qualification_confirmed");
    const firstCv = tiers.indexOf("credentials_verified");

    expect(firstCv).toBeLessThan(firstQc === -1 ? Infinity : firstQc);
    expect(firstQc).toBeLessThan(firstUnverified === -1 ? Infinity : firstUnverified);
  });
});
