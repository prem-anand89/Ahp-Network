// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.

export default function CommunitiesLoading() {
  return (
    <main id="main" className="mx-auto max-w-2xl animate-pulse px-6 py-10">
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="mt-6 space-y-3">
        <div className="h-16 rounded-2xl bg-muted" />
        <div className="h-16 rounded-2xl bg-muted" />
        <div className="h-16 rounded-2xl bg-muted" />
      </div>
    </main>
  );
}
