// §8G3/§8G5 — the feedback backlog and its grievance-category sibling.
// 'verification_issue' is a red herring for this queue: it routes the
// reporter to the existing verification admin queue rather than landing
// here (see routeFeedbackCategory), same as §8G5 specifies.

import { and, count, desc, eq, gte, isNull, ne } from "drizzle-orm";
import { feedback, type feedbackCategoryEnum, type feedbackStatusEnum } from "@/db/schema";
import type { getDb } from "@/db/db";
import { writeAuditLog } from "./audit";

type Db = Awaited<ReturnType<typeof getDb>>;
export type FeedbackCategory = (typeof feedbackCategoryEnum.enumValues)[number];
export type FeedbackStatus = (typeof feedbackStatusEnum.enumValues)[number];

const DAILY_RATE_LIMIT = 5;

export class FeedbackRateLimitError extends Error {
  constructor() {
    super(`No more than ${DAILY_RATE_LIMIT} feedback submissions per person per day`);
    this.name = "FeedbackRateLimitError";
  }
}

export interface SubmitFeedbackInput {
  userId: string | null;
  category: FeedbackCategory;
  message: string;
  contactOk: boolean;
  context?: Record<string, unknown>;
}

/**
 * 'verification_issue' isn't a real category for this backlog — it belongs
 * to the existing credential-verification admin queue (§8A2), so the
 * calling surface should redirect there instead of ever calling this with
 * that category. Guarded here too so a stray call fails loudly.
 */
export function routeFeedbackCategory(category: FeedbackCategory): "verification_queue" | "feedback_backlog" {
  return category === "verification_issue" ? "verification_queue" : "feedback_backlog";
}

export async function submitFeedbackTx(db: Db, input: SubmitFeedbackInput): Promise<{ id: string }> {
  if (routeFeedbackCategory(input.category) !== "feedback_backlog") {
    throw new Error("verification_issue reports go through the verification queue, not feedback");
  }

  if (input.userId) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ recent }] = await db
      .select({ recent: count() })
      .from(feedback)
      .where(and(eq(feedback.userId, input.userId), gte(feedback.createdAt, since)));

    if (recent >= DAILY_RATE_LIMIT) {
      throw new FeedbackRateLimitError();
    }
  }

  const [row] = await db
    .insert(feedback)
    .values({
      userId: input.userId,
      category: input.category,
      message: input.message,
      contactOk: input.contactOk,
      context: input.context ?? {},
    })
    .returning({ id: feedback.id });

  return { id: row.id };
}

export interface FeedbackListItem {
  id: string;
  userId: string | null;
  category: FeedbackCategory;
  message: string;
  contactOk: boolean;
  status: FeedbackStatus;
  adminNotes: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** Triage backlog, oldest-unresolved first, excluding grievance (§8G5
 * gives grievance its own dedicated screen, not mixed into general triage). */
export async function listFeedbackBacklog(db: Db): Promise<FeedbackListItem[]> {
  return db
    .select()
    .from(feedback)
    .where(ne(feedback.category, "grievance"))
    .orderBy(feedback.status, desc(feedback.createdAt));
}

/** Grievance-category items only, for the dedicated grievance admin screen. */
export async function listGrievances(db: Db): Promise<FeedbackListItem[]> {
  return db
    .select()
    .from(feedback)
    .where(eq(feedback.category, "grievance"))
    .orderBy(desc(feedback.createdAt));
}

export interface UpdateFeedbackStatusInput {
  actingUserId: string;
  feedbackId: string;
  status: FeedbackStatus;
  adminNotes?: string;
}

export async function updateFeedbackStatusTx(db: Db, input: UpdateFeedbackStatusInput): Promise<void> {
  await db
    .update(feedback)
    .set({ status: input.status, adminNotes: input.adminNotes, updatedAt: new Date() })
    .where(eq(feedback.id, input.feedbackId));

  await writeAuditLog(db, {
    actorUserId: input.actingUserId,
    actingContext: "admin",
    action: "feedback_status_updated",
    targetTable: "feedback",
    targetId: input.feedbackId,
    outcome: "success",
    afterState: { status: input.status },
  });
}

export interface AcknowledgeGrievanceInput {
  actingUserId: string;
  feedbackId: string;
}

/** §8G5 — grievance items get their own acknowledge/resolve timestamps,
 * distinct from the generic status field. */
export async function acknowledgeGrievanceTx(db: Db, input: AcknowledgeGrievanceInput): Promise<void> {
  await db
    .update(feedback)
    .set({ acknowledgedAt: new Date(), status: "triaged", updatedAt: new Date() })
    .where(and(eq(feedback.id, input.feedbackId), eq(feedback.category, "grievance"), isNull(feedback.acknowledgedAt)));

  await writeAuditLog(db, {
    actorUserId: input.actingUserId,
    actingContext: "admin",
    action: "grievance_acknowledged",
    targetTable: "feedback",
    targetId: input.feedbackId,
    outcome: "success",
  });
}

export interface ResolveGrievanceInput {
  actingUserId: string;
  feedbackId: string;
  adminNotes?: string;
}

export async function resolveGrievanceTx(db: Db, input: ResolveGrievanceInput): Promise<void> {
  await db
    .update(feedback)
    .set({ resolvedAt: new Date(), adminNotes: input.adminNotes, updatedAt: new Date() })
    .where(and(eq(feedback.id, input.feedbackId), eq(feedback.category, "grievance")));

  await writeAuditLog(db, {
    actorUserId: input.actingUserId,
    actingContext: "admin",
    action: "grievance_resolved",
    targetTable: "feedback",
    targetId: input.feedbackId,
    outcome: "success",
  });
}
