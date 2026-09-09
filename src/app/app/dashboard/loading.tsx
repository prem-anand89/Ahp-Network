// Own Suspense boundary for this route, not the shared one at
// app/app/loading.tsx — sibling /app/* routes sharing a single boundary
// is what let fast navigation between them (e.g. dashboard -> referrals)
// hit React error #419 ("This Suspense boundary received an update
// before it finished hydrating"), which cascaded into the "Connection
// closed" crash caught by app/app/error.tsx. Giving each frequently-
// visited route its own boundary removes the shared state that race
// depended on.

export default function DashboardLoading() {
  return (
    <main id="main" className="mx-auto max-w-3xl animate-pulse px-6 py-10">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="mt-6 space-y-4">
        <div className="h-24 rounded-md bg-muted" />
        <div className="h-24 rounded-md bg-muted" />
        <div className="h-24 rounded-md bg-muted" />
      </div>
    </main>
  );
}
