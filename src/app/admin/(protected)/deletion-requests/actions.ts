"use server";

// §8H erasure requests — admin-triggered, not user self-service (a real
// person asks through a support channel; an admin then runs it here).
// super_admin only, same bar as Team & Roles.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdminAccess } from "@/lib/require-admin-access";
import { runErasureRequestTx, type ErasureResult } from "@/lib/erasure";
import { requestDataExportTx } from "@/lib/data-export";
import { users } from "@/db/schema";
import type { R2Env } from "@/lib/r2";

export interface RunErasureResult {
  ok: boolean;
  error?: string;
  result?: ErasureResult;
}

export async function runErasureRequest(targetEmail: string): Promise<RunErasureResult> {
  const { db, userId } = await requireAdminAccess({ type: "run_erasure_request" });

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, targetEmail));
  if (!target) {
    return { ok: false, error: `No user with email ${targetEmail}` };
  }

  const { env } = await getCloudflareContext({ async: true });

  try {
    const result = await runErasureRequestTx(db, env as unknown as R2Env, {
      actingUserId: userId,
      targetUserId: target.id,
    });
    revalidatePath("/admin/deletion-requests");
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erasure request failed" };
  }
}

export interface RequestExportResult {
  ok: boolean;
  error?: string;
}

export async function requestDataExport(targetEmail: string): Promise<RequestExportResult> {
  const { db } = await requireAdminAccess({ type: "run_erasure_request" });

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, targetEmail));
  if (!target) {
    return { ok: false, error: `No user with email ${targetEmail}` };
  }

  const { env } = await getCloudflareContext({ async: true });

  try {
    await requestDataExportTx(db, env as unknown as R2Env, target.id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Data export failed" };
  }
}
