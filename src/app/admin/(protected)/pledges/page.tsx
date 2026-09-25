import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { getCityPledgeProgress, getCommunityProposalsAtThreshold, PLEDGE_THRESHOLD } from "@/lib/pledges";
import { createCommunityFromProposal, unlockCity } from "./actions";

export default async function PledgesPage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_pledges" });

  const [cities, proposals] = await Promise.all([
    getCityPledgeProgress(db),
    getCommunityProposalsAtThreshold(db),
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-6">
      <div>
        <h1 className="text-xl font-semibold">Pledges</h1>
        <p className="text-sm text-muted-foreground">
          Plan decisions 1 & 2 — unlock is always a human action. Reaching {PLEDGE_THRESHOLD} pledges makes a
          target eligible here; nothing fires automatically.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">City unlock</h2>
        {cities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pledged cities yet.</p>
        ) : (
          <ul className="space-y-4">
            {cities.map((c) => {
              // Round 3 step E — prerequisites are informational only now
              // (either verified tier can accept, so a missing council no
              // longer blocks participation); only the pledge threshold
              // gates the button.
              const canUnlock = c.pledgeCount >= PLEDGE_THRESHOLD;
              return (
                <li key={c.cityAreaId} className="rounded-md border p-4">
                  <p className="font-medium">
                    {c.cityName} — {c.pledgeCount} of {PLEDGE_THRESHOLD} pledged
                  </p>
                  <ul className="mt-1 text-sm text-muted-foreground">
                    <li>{c.hasAreaTree ? "✓" : "✗"} Curated areas tree</li>
                    <li>{c.hasStatutoryCouncil ? "✓" : "✗"} Statutory council on file</li>
                  </ul>
                  <form action={unlockCity.bind(null, c.cityAreaId)} className="mt-3">
                    <button
                      type="submit"
                      disabled={!canUnlock}
                      className="rounded-md border px-3 py-1 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Unlock
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Community proposals at threshold</h2>
        {proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing at {PLEDGE_THRESHOLD} pledges yet.</p>
        ) : (
          <ul className="space-y-4">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-md border p-4">
                <p className="font-medium">{p.name}</p>
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.pledgeCount} pledged · proposed by {p.proposedByDisplayName ?? "a therapist"}
                </p>
                <form action={createCommunityFromProposal.bind(null, p.id)} className="mt-3">
                  <button type="submit" className="rounded-md border px-3 py-1 text-sm hover:bg-accent">
                    Create community
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
