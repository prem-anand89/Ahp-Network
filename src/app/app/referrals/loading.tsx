// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.

export default function ReferralsLoading() {
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
