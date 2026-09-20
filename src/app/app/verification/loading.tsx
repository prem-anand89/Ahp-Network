// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): a credential-status card (badge-
// shaped chip + two lines) followed by upload-form-shaped rows.

import { Skeleton } from "@/components/ui/skeleton";

export default function VerificationLoading() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10">
      <Skeleton className="h-8 w-48" />

      <div className="mt-6 rounded-card border p-4">
        <Skeleton className="h-5 w-40 rounded-pill" />
        <Skeleton className="mt-3 h-3.5 w-full" />
        <Skeleton className="mt-2 h-3.5 w-2/3" />
      </div>

      <div className="mt-6 space-y-3">
        <Skeleton className="h-11 rounded-input" />
        <Skeleton className="h-24 rounded-input" />
        <Skeleton className="h-11 w-32 rounded-pill" />
      </div>
    </main>
  );
}
