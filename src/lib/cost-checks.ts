// Phase 12 — "cost-trigger alerts... Hyperdrive daily query count
// approaching 100,000, [v19] Supabase connection utilization sustained
// above ~70%." Only the checks that are actually a SQL query live here:
// Supabase connection utilization and database storage size. Hyperdrive's
// daily query count, R2 storage, Google Places spend, and OCR volume are
// Cloudflare/GCP billing-side metrics with no equivalent Postgres query —
// those are configured as dashboard alerts instead (see
// docs/cost-alerts-runbook.md for the exact steps and thresholds).

import type { getDb } from "@/db/db";

type Db = Awaited<ReturnType<typeof getDb>>;

const CONNECTION_UTILIZATION_ALERT_THRESHOLD = 0.7; // §7: "sustained above ~70%"

export interface CostCheckAlert {
  check: "supabase_connection_utilization" | "supabase_database_size";
  message: string;
}

export interface CostCheckResult {
  healthy: boolean;
  alerts: CostCheckAlert[];
  connectionUtilization: number;
  activeConnections: number;
  maxConnections: number;
  databaseSizeBytes: number;
}

/**
 * `pg_stat_activity`/`max_connections` are both readable by any role in a
 * default Postgres setup — no special grant needed beyond what `ahp_app`
 * already has. Uses the raw postgres.js client (db.$client), same pattern
 * as the referral-transition functions and purge_old_audit_logs() — a
 * single read-only statement each, no reason to go through drizzle's
 * query builder for a system-catalog read.
 */
export async function checkCostTriggers(db: Db): Promise<CostCheckResult> {
  const [{ active_connections: activeConnections }] = await db.$client<{ active_connections: number }[]>`
    SELECT count(*)::int AS active_connections FROM pg_stat_activity`;
  const [{ max_connections: maxConnections }] = await db.$client<{ max_connections: number }[]>`
    SELECT setting::int AS max_connections FROM pg_settings WHERE name = 'max_connections'`;
  // postgres.js returns bigint columns as strings by default (values can
  // exceed JS's safe integer range) — this database's size never will, so
  // casting straight to Number here is safe and keeps the return type simple.
  const [{ database_size: databaseSizeRaw }] = await db.$client<{ database_size: string }[]>`
    SELECT pg_database_size(current_database())::bigint AS database_size`;
  const databaseSizeBytes = Number(databaseSizeRaw);

  const connectionUtilization = maxConnections > 0 ? activeConnections / maxConnections : 0;
  const alerts: CostCheckAlert[] = [];

  if (connectionUtilization > CONNECTION_UTILIZATION_ALERT_THRESHOLD) {
    alerts.push({
      check: "supabase_connection_utilization",
      message: `Connection utilization at ${(connectionUtilization * 100).toFixed(1)}% (${activeConnections}/${maxConnections}), above the ${CONNECTION_UTILIZATION_ALERT_THRESHOLD * 100}% threshold — review whether Supabase Pro's larger compute tier or a connection-limit increase is warranted (§7)`,
    });
  }

  return {
    healthy: alerts.length === 0,
    alerts,
    connectionUtilization,
    activeConnections,
    maxConnections,
    databaseSizeBytes,
  };
}
