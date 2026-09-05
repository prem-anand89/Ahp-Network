// [H2] (Phase 12) — "liveness monitoring on the outbox worker and the
// deadline scheduler — a hard item, not a nice-to-have." Both jobs carry
// the entire referral engine and both fail *silently*: a dead outbox
// worker means referrals post fine and nobody is ever notified; a dead
// scheduler means offers never lapse and referrals hang in `shortlisted`
// forever. Neither is visible from the UI.
//
// Each job writes last_completed_at (via app_settings, keyed
// "heartbeat:<job>") at the end of a successful run; this module reads
// those back and alerts when either exceeds twice its expected interval —
// exactly the rule this section specifies, no more elaborate than that.

import { getAppSetting, setAppSetting } from "./app-settings";
import { countStalePendingNotifications } from "./notification-outbox-worker";
import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export type LivenessJob = "notification_outbox_worker" | "referral_scheduler";

// Matches the two workflows' real cadence (notification-worker.yml: every
// 2 minutes; referral-scheduler.yml: every 15 minutes).
const EXPECTED_INTERVAL_MINUTES: Record<LivenessJob, number> = {
  notification_outbox_worker: 2,
  referral_scheduler: 15,
};

const STALE_PENDING_NOTIFICATION_MINUTES = 10;

function heartbeatKey(job: LivenessJob): string {
  return `heartbeat:${job}`;
}

/** Called at the end of a successful cron run — nowhere else. A run that
 * throws before reaching this line correctly leaves the heartbeat stale,
 * which is the point. */
export async function recordHeartbeat(db: Db, job: LivenessJob): Promise<void> {
  await setAppSetting(db, heartbeatKey(job), new Date().toISOString());
}

export interface LivenessAlert {
  job: LivenessJob | "notification_outbox_depth";
  message: string;
}

export interface LivenessCheckResult {
  healthy: boolean;
  alerts: LivenessAlert[];
  heartbeats: Partial<Record<LivenessJob, string | null>>;
  stalePendingNotifications: number;
}

export async function checkLiveness(db: Db): Promise<LivenessCheckResult> {
  const alerts: LivenessAlert[] = [];
  const heartbeats: Partial<Record<LivenessJob, string | null>> = {};

  for (const job of Object.keys(EXPECTED_INTERVAL_MINUTES) as LivenessJob[]) {
    const raw = await getAppSetting(db, heartbeatKey(job));
    const lastCompletedAt = typeof raw === "string" ? raw : null;
    heartbeats[job] = lastCompletedAt;

    const staleThresholdMs = EXPECTED_INTERVAL_MINUTES[job] * 2 * 60 * 1000;
    const ageMs = lastCompletedAt ? Date.now() - new Date(lastCompletedAt).getTime() : Infinity;

    if (ageMs > staleThresholdMs) {
      alerts.push({
        job,
        message: lastCompletedAt
          ? `${job} last completed ${lastCompletedAt}, exceeding its ${EXPECTED_INTERVAL_MINUTES[job] * 2}-minute staleness threshold`
          : `${job} has never recorded a heartbeat`,
      });
    }
  }

  const stalePendingNotifications = await countStalePendingNotifications(db, STALE_PENDING_NOTIFICATION_MINUTES);
  if (stalePendingNotifications > 0) {
    alerts.push({
      job: "notification_outbox_depth",
      message: `${stalePendingNotifications} notification(s) still pending ${STALE_PENDING_NOTIFICATION_MINUTES}+ minutes after they became claimable — the worker may be running but failing every send`,
    });
  }

  return { healthy: alerts.length === 0, alerts, heartbeats, stalePendingNotifications };
}
