// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): the create-circle form row, then a
// bordered list of circle rows (name + member count), matching
// circles-manager.tsx's actual composition.

import { Skeleton } from "@/components/ui/skeleton";

export default function CirclesLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Skeleton className="h-8 w-32" />

      <div className="mt-6 flex items-center gap-2">
        <Skeleton className="h-11 flex-1 rounded-input" />
        <Skeleton className="h-11 w-24 rounded-pill" />
      </div>

      <div className="mt-6 divide-y rounded-md border">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </main>
  );
}
