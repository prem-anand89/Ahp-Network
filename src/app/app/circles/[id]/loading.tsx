// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): back link, circle name, then a
// member-row list (avatar + name), instead of two flat grey blocks.

import { Skeleton } from "@/components/ui/skeleton";

export default function CircleDetailLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-3 h-8 w-48" />

      <div className="mt-6 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-card border p-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
