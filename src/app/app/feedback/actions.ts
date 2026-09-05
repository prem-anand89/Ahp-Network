"use server";

// Public feedback submission — §8G3. verification_issue is deliberately
// not offered here; a credential/verification concern routes to the
// existing verification queue (/app/verification), not this backlog.

import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { submitFeedbackTx, FeedbackRateLimitError, type FeedbackCategory } from "@/lib/feedback";

export interface SubmitFeedbackResult {
  ok: boolean;
  error?: string;
}

export async function submitFeedback(
  category: FeedbackCategory,
  message: string,
  contactOk: boolean,
): Promise<SubmitFeedbackResult> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  const db = await getDb();
  try {
    await submitFeedbackTx(db, { userId: authUser?.id ?? null, category, message, contactOk });
  } catch (error) {
    if (error instanceof FeedbackRateLimitError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: error instanceof Error ? error.message : "Failed to submit feedback" };
  }
  return { ok: true };
}
