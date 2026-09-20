// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): a step dot-strip (Phase 2 rebuilds
// onboarding around this, per the plan; the skeleton anticipates its
// shape) above a couple of form-field-shaped rows.

import { Skeleton } from "@/components/ui/skeleton";

export default function OnboardingLoading() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-1.5 flex-1 rounded-pill" />
        ))}
      </div>
      <Skeleton className="mt-6 h-8 w-48" />
      <div className="mt-6 space-y-4">
        <Skeleton className="h-11 rounded-input" />
        <Skeleton className="h-11 rounded-input" />
      </div>
    </main>
  );
}
