// Feedback triage backlog, excluding grievance — §8G3, support_admin or
// super_admin only.

import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { listFeedbackBacklog } from "@/lib/feedback";
import { updateFeedbackStatus } from "./actions";
import type { FeedbackStatus } from "@/lib/feedback";

const STATUS_OPTIONS: FeedbackStatus[] = ["new", "triaged", "planned", "shipped", "wont_do"];

export default async function FeedbackPage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_feedback" });
  const backlog = await listFeedbackBacklog(db);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Feedback backlog</h1>
      <p className="text-sm text-muted-foreground">
        Bug reports, feature requests, and content issues — grievance-category items have their
        own dedicated queue.
      </p>

      {backlog.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {backlog.map((item) => (
            <li key={item.id} className="rounded-md border p-4">
              <p className="text-xs font-medium uppercase text-muted-foreground">{item.category}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{item.message}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Submitted {item.createdAt.toLocaleString()} — contact ok: {item.contactOk ? "yes" : "no"}
              </p>
              <form
                action={async (formData: FormData) => {
                  "use server";
                  await updateFeedbackStatus(
                    item.id,
                    formData.get("status") as FeedbackStatus,
                    String(formData.get("notes") ?? ""),
                  );
                }}
                className="mt-3 flex flex-wrap items-center gap-2"
              >
                <select name="status" defaultValue={item.status} className="rounded-md border bg-background px-2 py-1 text-sm">
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  name="notes"
                  defaultValue={item.adminNotes ?? ""}
                  placeholder="Admin notes"
                  className="rounded-md border px-2 py-1 text-sm"
                />
                <button type="submit" className="rounded-md border px-3 py-1 text-sm hover:bg-accent">
                  Update
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
