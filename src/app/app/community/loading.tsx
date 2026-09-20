// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): the founding-cohort community's
// bulletin post feed — same post-row shape as communities/[id].

import { Skeleton } from "@/components/ui/skeleton";

export default function CommunityLoading() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10">
      <Skeleton className="h-8 w-48" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-card border p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="mt-3 h-3.5 w-full" />
            <Skeleton className="mt-2 h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </main>
  );
}
