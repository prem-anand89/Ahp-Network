// Deletion requests — §8H's "on erasure request" flow, admin-triggered
// only (a real user asks through a support channel first). super_admin
// only, page-level gated given the blast radius.

import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { ErasureForm } from "./erasure-form";
import { ExportForm } from "./export-form";

export default async function DeletionRequestsPage() {
  await requireAdminAccessOrRedirect({ type: "run_erasure_request" });

  return (
    <main className="mx-auto max-w-lg space-y-8 p-6">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Data export</h1>
        <ExportForm />
      </div>
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Deletion requests</h1>
        <ErasureForm />
      </div>
    </main>
  );
}
