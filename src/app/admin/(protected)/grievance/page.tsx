// Grievance queue — §8G5, grievance_officer or super_admin only.
// Page-level gated: a grievance may name the reporting therapist and the
// substance of a complaint, so nobody outside the role should see the
// list even land on screen.

import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { listGrievances } from "@/lib/feedback";
import { acknowledgeGrievance, resolveGrievance } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function GrievancePage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_grievance" });
  const grievances = await listGrievances(db);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Grievance queue</h1>
      <p className="text-sm text-muted-foreground">
        Every complaint filed through the grievance channel — acknowledge on first review, resolve
        once actually addressed with the reporter.
      </p>

      {grievances.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {grievances.map((g) => (
            <li key={g.id} className="rounded-md border p-4">
              <p className="whitespace-pre-wrap text-sm">{g.message}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Submitted {g.createdAt.toLocaleString()} — contact ok: {g.contactOk ? "yes" : "no"}
                {g.acknowledgedAt && ` — acknowledged ${g.acknowledgedAt.toLocaleString()}`}
                {g.resolvedAt && ` — resolved ${g.resolvedAt.toLocaleString()}`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {!g.acknowledgedAt && (
                  <form action={acknowledgeGrievance.bind(null, g.id)}>
                    <Button type="submit" variant="outline" size="sm">
                      Acknowledge
                    </Button>
                  </form>
                )}
                {!g.resolvedAt && (
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      await resolveGrievance(g.id, String(formData.get("notes") ?? ""));
                    }}
                    className="flex items-center gap-2"
                  >
                    <Label htmlFor={`notes-${g.id}`} className="sr-only">Resolution notes</Label>
                    <Input id={`notes-${g.id}`} name="notes" placeholder="Resolution notes" className="w-auto" />
                    <Button type="submit" variant="outline" size="sm">
                      Resolve
                    </Button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
