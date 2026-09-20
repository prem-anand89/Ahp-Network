// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx. One of
// the four missing loading.tsx files Phase 1 step 17 adds.
//
// Layout-matched: the outcome report form — a select-shaped field, a
// notes textarea, then submit.

import { Skeleton } from "@/components/ui/skeleton";

export default function ReportOutcomeLoading() {
  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <Skeleton className="h-8 w-48" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-11 rounded-input" />
        <Skeleton className="h-24 rounded-input" />
        <Skeleton className="h-11 w-32 rounded-pill" />
      </div>
    </main>
  );
}
