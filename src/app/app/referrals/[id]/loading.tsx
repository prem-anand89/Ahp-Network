// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx. One of
// the four missing loading.tsx files Phase 1 step 17 adds.
//
// Layout-matched: title + badge chip, a patient-summary-shaped block,
// then an actions row.

import { Skeleton } from "@/components/ui/skeleton";

export default function ReferralDetailLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-pill" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <Skeleton className="mt-3 h-6 w-56" />

      <Skeleton className="mt-6 h-24 rounded-card" />

      <div className="mt-6 flex gap-2">
        <Skeleton className="h-11 w-28 rounded-pill" />
        <Skeleton className="h-11 w-28 rounded-pill" />
      </div>
    </main>
  );
}
