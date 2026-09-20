// Own Suspense boundary for this route, not the shared one at
// app/app/loading.tsx — sibling /app/* routes sharing a single boundary
// is what let fast navigation between them (e.g. dashboard -> referrals)
// hit React error #419 ("This Suspense boundary received an update
// before it finished hydrating"), which cascaded into the "Connection
// closed" crash caught by app/app/error.tsx. Giving each frequently-
// visited route its own boundary removes the shared state that race
// depended on.
//
// Layout-matched to the real page (Phase 1 step 17): reciprocity stat +
// completion checklist row, then a feed of referral/activity-card-shaped
// rows, rather than three identical grey blocks.

import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10">
      <Skeleton className="h-8 w-48" />

      <div className="mt-6 flex items-center gap-4 rounded-card border p-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-card border p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-16 rounded-pill" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </main>
  );
}
