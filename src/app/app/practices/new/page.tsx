// Phase 3 — /app/practices/new. Any verified therapist can create a
// practice listing (§8C); the form itself is a client component since it
// needs the Places autocomplete's live search.

import { PracticeCreateForm } from "./practice-create-form";

export const dynamic = "force-dynamic";

export default function NewPracticePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Add a practice</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Add the clinic, hospital department, or other practice you work at. It starts as an
        unclaimed listing — the owner can claim it afterward with documentation.
      </p>
      <div className="mt-6">
        <PracticeCreateForm />
      </div>
    </main>
  );
}
