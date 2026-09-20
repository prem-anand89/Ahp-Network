// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx. One of
// the four missing loading.tsx files Phase 1 step 17 adds.
//
// Layout-matched to the real page: a ProfileCard-shaped block (avatar +
// name + badge + tags) followed by the sections below it.

import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-10">
      <div className="rounded-card border p-5">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="mt-4 h-5 w-36 rounded-pill" />
        <div className="mt-3 flex gap-1.5">
          <Skeleton className="h-6 w-20 rounded-pill" />
          <Skeleton className="h-6 w-24 rounded-pill" />
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <Skeleton className="h-20 rounded-card" />
        <Skeleton className="h-20 rounded-card" />
      </div>
    </main>
  );
}
