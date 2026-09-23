// Runs against a real Postgres (local dev instance), never mocks — per
// BUILD_SEQUENCE.md Phase 0's test-stack convention. Round 2 step 3 —
// practice 2-way consent: either side initiates, the other accepts or
// declines, and only 'active' is ever a real membership.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  invitePracticeMemberByEmail,
  removePracticeMember,
  requestPracticeMembership,
  respondToPracticeInvite,
  respondToPracticeRequest,
} from "./practice-consent";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];
const createdPracticeIds: string[] = [];

afterEach(async () => {
  let practiceId: string | undefined;
  while ((practiceId = createdPracticeIds.pop()) !== undefined) {
    await client`DELETE FROM notification_outbox WHERE payload->>'practiceId' = ${practiceId}`;
    await client`DELETE FROM practice_users WHERE practice_id = ${practiceId}`;
    await client`DELETE FROM practices WHERE id = ${practiceId}`;
  }
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM notification_outbox WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createTherapist(email: string): Promise<string> {
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

async function createClaimedPractice(ownerId: string): Promise<string> {
  const [practice] = await client`
    INSERT INTO practices (name, type, created_by_user_id, normalized_name, normalized_address, claim_status)
    VALUES ('Test Physio Clinic', 'clinic', ${ownerId}, ${"test clinic " + crypto.randomUUID()}, 'test address', 'claimed')
    RETURNING id`;
  createdPracticeIds.push(practice.id);
  await client`
    INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, status, asserted_by, is_public)
    VALUES (${practice.id}, ${ownerId}, 'owner', 'owns', 'active', 'self', true)`;
  return practice.id;
}

describe("invitePracticeMemberByEmail", () => {
  it("only an active owner/manager can invite", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const outsider = await createTherapist(`outsider-${crypto.randomUUID()}@example.com`);
    const invitee = await createTherapist(`invitee-${crypto.randomUUID()}@example.com`);
    const practiceId = await createClaimedPractice(owner);

    await expect(
      invitePracticeMemberByEmail(db, { practiceId, inviterUserId: outsider, inviteeEmail: "x@x.com", accessRole: "staff" }),
    ).rejects.toThrow();

    await invitePracticeMemberByEmail(db, {
      practiceId,
      inviterUserId: owner,
      inviteeEmail: (await client`SELECT email FROM users WHERE id = ${invitee}`)[0].email,
      accessRole: "staff",
    });

    const [row] = await client`SELECT status, asserted_by FROM practice_users WHERE practice_id = ${practiceId} AND user_id = ${invitee}`;
    expect(row.status).toBe("invited");
    expect(row.asserted_by).toBe("practice");

    const [notification] = await client`SELECT template FROM notification_outbox WHERE user_id = ${invitee}`;
    expect(notification.template).toBe("practice_invite_received");
  });

  it("rejects a second invite while one is already pending", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const inviteeEmail = `invitee-${crypto.randomUUID()}@example.com`;
    const invitee = await createTherapist(inviteeEmail);
    const practiceId = await createClaimedPractice(owner);

    await invitePracticeMemberByEmail(db, { practiceId, inviterUserId: owner, inviteeEmail, accessRole: "staff" });
    await expect(
      invitePracticeMemberByEmail(db, { practiceId, inviterUserId: owner, inviteeEmail, accessRole: "staff" }),
    ).rejects.toThrow();
    void invitee;
  });
});

describe("respondToPracticeInvite", () => {
  it("accepting moves the row to active and notifies the owner", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const inviteeEmail = `invitee-${crypto.randomUUID()}@example.com`;
    const invitee = await createTherapist(inviteeEmail);
    const practiceId = await createClaimedPractice(owner);
    await invitePracticeMemberByEmail(db, { practiceId, inviterUserId: owner, inviteeEmail, accessRole: "staff" });

    await respondToPracticeInvite(db, { practiceId, therapistUserId: invitee, accept: true });

    const [row] = await client`SELECT status, started_at FROM practice_users WHERE practice_id = ${practiceId} AND user_id = ${invitee}`;
    expect(row.status).toBe("active");
    expect(row.started_at).not.toBeNull();

    const [notification] = await client`SELECT template FROM notification_outbox WHERE user_id = ${owner} AND template = 'practice_member_joined'`;
    expect(notification).toBeDefined();
  });

  it("declining moves the row to declined, not removed", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const inviteeEmail = `invitee-${crypto.randomUUID()}@example.com`;
    const invitee = await createTherapist(inviteeEmail);
    const practiceId = await createClaimedPractice(owner);
    await invitePracticeMemberByEmail(db, { practiceId, inviterUserId: owner, inviteeEmail, accessRole: "staff" });

    await respondToPracticeInvite(db, { practiceId, therapistUserId: invitee, accept: false });

    const [row] = await client`SELECT status, ended_at FROM practice_users WHERE practice_id = ${practiceId} AND user_id = ${invitee}`;
    expect(row.status).toBe("declined");
    expect(row.ended_at).toBeNull();
  });

  it("throws when there's no pending invite for this therapist", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const stranger = await createTherapist(`stranger-${crypto.randomUUID()}@example.com`);
    const practiceId = await createClaimedPractice(owner);

    await expect(
      respondToPracticeInvite(db, { practiceId, therapistUserId: stranger, accept: true }),
    ).rejects.toThrow();
  });
});

describe("requestPracticeMembership / respondToPracticeRequest", () => {
  it("a request notifies the active owner, and approval activates it", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const requester = await createTherapist(`requester-${crypto.randomUUID()}@example.com`);
    const practiceId = await createClaimedPractice(owner);

    await requestPracticeMembership(db, { practiceId, requesterUserId: requester });

    const [pending] = await client`SELECT status, asserted_by, access_role FROM practice_users WHERE practice_id = ${practiceId} AND user_id = ${requester}`;
    expect(pending.status).toBe("requested");
    expect(pending.asserted_by).toBe("self");
    expect(pending.access_role).toBe("staff");

    const [notification] = await client`SELECT template FROM notification_outbox WHERE user_id = ${owner} AND template = 'practice_request_received'`;
    expect(notification).toBeDefined();

    await respondToPracticeRequest(db, { practiceId, requesterUserId: requester, responderUserId: owner, accept: true });
    const [row] = await client`SELECT status FROM practice_users WHERE practice_id = ${practiceId} AND user_id = ${requester}`;
    expect(row.status).toBe("active");
  });

  it("a non-owner/manager can't approve a request", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const requester = await createTherapist(`requester-${crypto.randomUUID()}@example.com`);
    const outsider = await createTherapist(`outsider-${crypto.randomUUID()}@example.com`);
    const practiceId = await createClaimedPractice(owner);
    await requestPracticeMembership(db, { practiceId, requesterUserId: requester });

    await expect(
      respondToPracticeRequest(db, { practiceId, requesterUserId: requester, responderUserId: outsider, accept: true }),
    ).rejects.toThrow();
  });
});

describe("removePracticeMember", () => {
  it("self-leave is always allowed", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const staffEmail = `staff-${crypto.randomUUID()}@example.com`;
    const staff = await createTherapist(staffEmail);
    const practiceId = await createClaimedPractice(owner);
    await invitePracticeMemberByEmail(db, { practiceId, inviterUserId: owner, inviteeEmail: staffEmail, accessRole: "staff" });
    await respondToPracticeInvite(db, { practiceId, therapistUserId: staff, accept: true });

    await removePracticeMember(db, { practiceId, actingUserId: staff, targetUserId: staff });

    const [row] = await client`SELECT status, ended_at FROM practice_users WHERE practice_id = ${practiceId} AND user_id = ${staff}`;
    expect(row.status).toBe("removed");
    expect(row.ended_at).not.toBeNull();
  });

  it("an owner can remove a practice-invited member", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const staffEmail = `staff-${crypto.randomUUID()}@example.com`;
    const staff = await createTherapist(staffEmail);
    const practiceId = await createClaimedPractice(owner);
    await invitePracticeMemberByEmail(db, { practiceId, inviterUserId: owner, inviteeEmail: staffEmail, accessRole: "staff" });
    await respondToPracticeInvite(db, { practiceId, therapistUserId: staff, accept: true });

    await removePracticeMember(db, { practiceId, actingUserId: owner, targetUserId: staff });

    const [row] = await client`SELECT status FROM practice_users WHERE practice_id = ${practiceId} AND user_id = ${staff}`;
    expect(row.status).toBe("removed");
  });

  it("an owner can never remove a self-asserted ('self') affiliation — schema.ts's own invariant", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const staff = await createTherapist(`staff-${crypto.randomUUID()}@example.com`);
    const practiceId = await createClaimedPractice(owner);
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, status, asserted_by, is_public)
      VALUES (${practiceId}, ${staff}, 'staff', 'works_at', 'active', 'self', true)`;

    await expect(
      removePracticeMember(db, { practiceId, actingUserId: owner, targetUserId: staff }),
    ).rejects.toThrow();
  });

  it("an owner row can never be removed by another team member", async () => {
    const owner = await createTherapist(`owner-${crypto.randomUUID()}@example.com`);
    const manager = await createTherapist(`manager-${crypto.randomUUID()}@example.com`);
    const practiceId = await createClaimedPractice(owner);
    await client`
      INSERT INTO practice_users (practice_id, user_id, access_role, relationship_type, status, asserted_by, is_public)
      VALUES (${practiceId}, ${manager}, 'manager', 'works_at', 'active', 'practice', true)`;

    await expect(
      removePracticeMember(db, { practiceId, actingUserId: manager, targetUserId: owner }),
    ).rejects.toThrow();
  });
});
