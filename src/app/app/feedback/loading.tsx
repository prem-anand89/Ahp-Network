// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): a single-field form (title +
// textarea + submit button) instead of one flat grey block.

import { Skeleton } from "@/components/ui/skeleton";

export default function FeedbackLoading() {
  return (
    <main id="main" className="mx-auto max-w-lg space-y-6 p-6">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-32 rounded-input" />
      <Skeleton className="h-11 w-28 rounded-pill" />
    </main>
  );
}
