// §8G5 — "every insert/update writes audit_logs, no PII." The reusable
// writer for admin write actions built from Phase 10 onward (Team & Roles,
// grievance/feedback triage, communities moderation). Earlier admin
// actions (Phase 3/4's verification queue and practice claims) predate
// this helper and don't yet call it — a real, pre-existing gap, not
// something this file silently papers over. New admin actions use this.

import type { getDb } from "@/db/db";
import { auditLogs } from "@/db/schema";

type Db = Awaited<ReturnType<typeof getDb>>;

export interface AuditLogInput {
  actorUserId: string;
  actingContext: "therapist" | "admin";
  action: string;
  targetTable?: string;
  targetId?: string;
  outcome: "success" | "failure";
  /** Never raw PII — a field name and a change-happened marker, same
   * redaction discipline as sensitive-identity-change.ts. */
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  ipAddress?: string;
}

export async function writeAuditLog(db: Db, input: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    actorType: "admin",
    actingContext: input.actingContext,
    action: input.action,
    targetTable: input.targetTable,
    targetId: input.targetId,
    outcome: input.outcome,
    beforeState: input.beforeState,
    afterState: input.afterState,
    ipAddress: input.ipAddress,
  });
}
