// Fallback only, for any future /app/* route that doesn't define its own
// loading.tsx. The actual nav-linked routes (dashboard, referrals,
// community, verification, feedback) and onboarding each now have their
// own — sharing this one boundary across siblings is what let fast
// navigation between them race on Suspense hydration state (React error
// #419), cascading into the "Connection closed" crash caught by
// app/app/error.tsx. See any of those routes' loading.tsx for the fuller
// explanation.
export default function AppLoading() {
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
