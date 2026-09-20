// Fallback only, for any future /app/* route that doesn't define its own
// loading.tsx. The actual nav-linked routes (dashboard, referrals,
// community, verification, feedback) and onboarding each now have their
// own — sharing this one boundary across siblings is what let fast
// navigation between them race on Suspense hydration state (React error
// #419), cascading into the "Connection closed" crash caught by
// app/app/error.tsx. See any of those routes' loading.tsx for the fuller
// explanation.

import { Skeleton } from "@/components/ui/skeleton";

export default function AppLoading() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-10">
      <Skeleton className="h-8 w-48" />
      <div className="mt-6 space-y-4">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-24 rounded-card" />
      </div>
    </main>
  );
}
