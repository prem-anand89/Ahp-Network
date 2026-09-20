// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): community rows with an
// AvatarInitials-shaped circle + two lines + a join-button-shaped
// element, matching the real page's row composition.

import { Skeleton } from "@/components/ui/skeleton";

export default function CommunitiesLoading() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-10">
      <Skeleton className="h-8 w-48" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-card border p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-8 w-16 rounded-pill" />
          </div>
        ))}
      </div>
    </main>
  );
}
