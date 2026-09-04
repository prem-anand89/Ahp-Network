// Placeholder — a later phase builds the real therapist dashboard. This
// page exists so /app/* has a route to render during the CI static/dynamic
// assertion, and so the (auth) login flow has somewhere real to land.

export default function DashboardPlaceholder() {
  return <main className="p-6">Dashboard — Phase 1</main>;
}
