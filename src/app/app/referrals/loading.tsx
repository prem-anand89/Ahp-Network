// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.
//
// Layout-matched (Phase 1 step 17): header + "Post a referral" button,
// then two sections (Posted by you / Matched to you) each with
// ReferralCard-shaped rows — badge chip, title line, footer row —
// instead of three identical grey blocks.

import { Skeleton } from "@/components/ui/skeleton";

function ReferralCardSkeleton() {
  return (
    <div className="rounded-card border p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-pill" />
        <Skeleton className="h-3.5 w-20" />
      </div>
      <Skeleton className="mt-3 h-4 w-3/4" />
      <div className="mt-3 flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-20 rounded-pill" />
      </div>
    </div>
  );
}

export default function ReferralsLoading() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-32 rounded-pill" />
      </div>

      <section className="mt-8">
        <Skeleton className="h-3.5 w-24" />
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReferralCardSkeleton />
          <ReferralCardSkeleton />
        </div>
      </section>

      <section className="mt-10">
        <Skeleton className="h-3.5 w-28" />
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReferralCardSkeleton />
          <ReferralCardSkeleton />
        </div>
      </section>
    </main>
  );
}
