// Referral ops — §8G6, referral_ops_admin or super_admin. Read-only alerts
// only; at 25-30 users a human following up beats a notification ladder
// (§G1-G4), so this screen surfaces what needs a human, it doesn't act.

import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import {
  listEmptyPoolReferrals,
  listRerouteEscalations,
  listUnservedUrgentReferrals,
  type ReferralOpsAlertRow,
} from "@/lib/referral-ops";

function AlertList({ rows }: { rows: ReferralOpsAlertRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md border p-3 text-sm">
          <span className="font-medium">{r.roleNeeded}</span> — {r.status}, {r.urgency}, reroutes:{" "}
          {r.rerouteCount}, pool at post: {r.matchedPoolSizeAtPost ?? "—"} — posted{" "}
          {r.createdAt.toLocaleString()}
        </li>
      ))}
    </ul>
  );
}

export default async function ReferralOpsPage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_referral_ops" });

  const [emptyPool, unservedUrgent, rerouteEscalations] = await Promise.all([
    listEmptyPoolReferrals(db),
    listUnservedUrgentReferrals(db),
    listRerouteEscalations(db),
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-xl font-semibold">Referral ops</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-destructive">Unserved urgent referrals</h2>
        <AlertList rows={unservedUrgent} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Empty-pool referrals</h2>
        <AlertList rows={emptyPool} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">2-reroute escalations</h2>
        <AlertList rows={rerouteEscalations} />
      </section>
    </main>
  );
}
