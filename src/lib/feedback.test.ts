// §8G3/§8G5 — runs against a real local Postgres, never mocks.

import { afterEach, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  acknowledgeGrievanceTx,
  FeedbackRateLimitError,
  listFeedbackBacklog,
  listGrievances,
  resolveGrievanceTx,
  routeFeedbackCategory,
  submitFeedbackTx,
  updateFeedbackStatusTx,
} from "./feedback";

const adminUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:localdev@127.0.0.1:5432/ahp_network_dev";
const client = postgres(adminUrl, { prepare: false, max: 5 });
const db = drizzle(client, { schema });

const createdUserIds: string[] = [];

afterEach(async () => {
  let userId: string | undefined;
  while ((userId = createdUserIds.pop()) !== undefined) {
    await client`DELETE FROM audit_logs WHERE actor_user_id = ${userId}`;
    await client`DELETE FROM feedback WHERE user_id = ${userId}`;
    await client`DELETE FROM users WHERE id = ${userId}`;
    await client`DELETE FROM auth.users WHERE id = ${userId}`;
  }
});

afterAll(async () => {
  await client.end();
});

async function createUser(): Promise<string> {
  const email = `feedback-${crypto.randomUUID()}@test.local`;
  const [authUser] = await client`INSERT INTO auth.users (email) VALUES (${email}) RETURNING id`;
  await client`INSERT INTO users (id, email, account_type) VALUES (${authUser.id}, ${email}, 'therapist')`;
  createdUserIds.push(authUser.id);
  return authUser.id;
}

describe("routeFeedbackCategory", () => {
  it("routes verification_issue away from the feedback backlog", () => {
    expect(routeFeedbackCategory("verification_issue")).toBe("verification_queue");
  });

  it("routes every other category to the feedback backlog", () => {
    expect(routeFeedbackCategory("bug")).toBe("feedback_backlog");
    expect(routeFeedbackCategory("grievance")).toBe("feedback_backlog");
  });
});

describe("submitFeedbackTx (§8G3)", () => {
  it("rejects verification_issue submissions", async () => {
    const user = await createUser();
    await expect(
      submitFeedbackTx(db, { userId: user, category: "verification_issue", message: "my creds are wrong", contactOk: false }),
    ).rejects.toThrow(/verification queue/);
  });

  it("inserts a feedback row", async () => {
    const user = await createUser();
    const { id } = await submitFeedbackTx(db, { userId: user, category: "bug", message: "the button is broken", contactOk: true });
    const [row] = await client`SELECT category, status FROM feedback WHERE id = ${id}`;
    expect(row.category).toBe("bug");
    expect(row.status).toBe("new");
  });

  it("enforces the 5/day/user rate limit", async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) {
      await submitFeedbackTx(db, { userId: user, category: "other", message: `report number ${i}`, contactOk: false });
    }
    await expect(
      submitFeedbackTx(db, { userId: user, category: "other", message: "one too many", contactOk: false }),
    ).rejects.toThrow(FeedbackRateLimitError);
  });

  it("does not rate-limit anonymous (null user) submissions", async () => {
    for (let i = 0; i < 6; i++) {
      await submitFeedbackTx(db, { userId: null, category: "other", message: `anon report ${i}`, contactOk: false });
    }
    await client`DELETE FROM feedback WHERE user_id IS NULL AND message LIKE 'anon report%'`;
  });
});

describe("listFeedbackBacklog / listGrievances", () => {
  it("excludes grievance from the general backlog and includes it in listGrievances", async () => {
    const user = await createUser();
    await submitFeedbackTx(db, { userId: user, category: "grievance", message: "a formal complaint here", contactOk: true });
    await submitFeedbackTx(db, { userId: user, category: "bug", message: "unrelated bug report", contactOk: false });

    const backlog = await listFeedbackBacklog(db);
    expect(backlog.some((f) => f.userId === user && f.category === "grievance")).toBe(false);
    expect(backlog.some((f) => f.userId === user && f.category === "bug")).toBe(true);

    const grievances = await listGrievances(db);
    expect(grievances.some((f) => f.userId === user && f.category === "grievance")).toBe(true);
  });
});

describe("updateFeedbackStatusTx", () => {
  it("updates status and writes an audit log entry", async () => {
    const admin = await createUser();
    const user = await createUser();
    const { id } = await submitFeedbackTx(db, { userId: user, category: "feature_request", message: "please add dark mode", contactOk: false });

    await updateFeedbackStatusTx(db, { actingUserId: admin, feedbackId: id, status: "planned" });

    const [row] = await client`SELECT status FROM feedback WHERE id = ${id}`;
    expect(row.status).toBe("planned");
    const [log] = await client`SELECT action FROM audit_logs WHERE actor_user_id = ${admin} AND action = 'feedback_status_updated'`;
    expect(log.action).toBe("feedback_status_updated");
  });
});

describe("acknowledgeGrievanceTx / resolveGrievanceTx (§8G5)", () => {
  it("acknowledges then resolves a grievance, writing audit log entries for each", async () => {
    const admin = await createUser();
    const user = await createUser();
    const { id } = await submitFeedbackTx(db, { userId: user, category: "grievance", message: "a formal complaint here too", contactOk: true });

    await acknowledgeGrievanceTx(db, { actingUserId: admin, feedbackId: id });
    let [row] = await client`SELECT acknowledged_at, resolved_at, status FROM feedback WHERE id = ${id}`;
    expect(row.acknowledged_at).not.toBeNull();
    expect(row.resolved_at).toBeNull();
    expect(row.status).toBe("triaged");

    await resolveGrievanceTx(db, { actingUserId: admin, feedbackId: id, adminNotes: "resolved directly with the reporter" });
    [row] = await client`SELECT resolved_at FROM feedback WHERE id = ${id}`;
    expect(row.resolved_at).not.toBeNull();

    const logs = await client`SELECT action FROM audit_logs WHERE actor_user_id = ${admin} AND target_id = ${id} ORDER BY created_at`;
    expect(logs.map((l) => l.action)).toEqual(["grievance_acknowledged", "grievance_resolved"]);
  });
});
