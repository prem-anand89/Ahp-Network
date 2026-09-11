// Own Suspense boundary — see dashboard/loading.tsx for why this exists
// per-route rather than relying on the shared app/app/loading.tsx.

export default function CircleDetailLoading() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-6 py-10">
      <div className="h-4 w-20 rounded-md bg-muted" />
      <div className="mt-3 h-8 w-48 rounded-md bg-muted" />
      <div className="mt-6 space-y-4">
        <div className="h-16 rounded-md bg-muted" />
        <div className="h-24 rounded-md bg-muted" />
      </div>
    </main>
  );
}
