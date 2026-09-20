// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.

import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileEditLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-3.5 w-64" />
      <div className="mt-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-pill" />
        </div>
        <Skeleton className="h-11 rounded-pill" />
        <Skeleton className="h-11 rounded-pill" />
        <Skeleton className="h-28 rounded-input" />
        <Skeleton className="h-11 w-24 rounded-pill" />
      </div>
    </main>
  );
}
