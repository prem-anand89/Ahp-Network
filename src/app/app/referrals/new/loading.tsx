// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx. One of
// the four missing loading.tsx files Phase 1 step 17 adds.
//
// Layout-matched: the post-referral form's field rhythm (several short
// fields, then the patient-summary textarea, then submit).

import { Skeleton } from "@/components/ui/skeleton";

export default function PostReferralLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-3.5 w-full" />
      <Skeleton className="mt-1 h-3.5 w-3/4" />

      <div className="mt-6 space-y-3">
        <Skeleton className="h-11 rounded-input" />
        <Skeleton className="h-11 rounded-input" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-11 rounded-input" />
          <Skeleton className="h-11 rounded-input" />
        </div>
        <Skeleton className="h-28 rounded-input" />
        <Skeleton className="h-11 w-36 rounded-pill" />
      </div>
    </main>
  );
}
