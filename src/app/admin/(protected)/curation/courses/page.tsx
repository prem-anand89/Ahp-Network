import { eq, isNull, and } from "drizzle-orm";
import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { courseCompletions, masterCoursesCertifications } from "@/db/schema";
import { approveCourseCompletion, rejectCourseCompletion } from "../actions";

export default async function CourseCurationQueuePage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_curation_queue" });

  const pending = await db
    .select()
    .from(courseCompletions)
    .where(
      and(
        eq(courseCompletions.curationStatus, "pending_review"),
        isNull(courseCompletions.deletedAt),
      ),
    );

  const masterCourses = await db
    .select({ id: masterCoursesCertifications.id, name: masterCoursesCertifications.name })
    .from(masterCoursesCertifications)
    .where(eq(masterCoursesCertifications.isActive, true));

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Course &amp; certification curation queue</h1>
      <p className="text-sm text-muted-foreground">
        A submitted course/certification name with no confident match against the master list.
        Link it to an existing master row, or reject it if it isn&apos;t a real credential.
      </p>

      {pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing pending.</p>
      ) : (
        <ul className="space-y-4">
          {pending.map((row) => (
            <li key={row.id} className="rounded-md border p-4">
              <p className="font-medium">{row.customCourseName ?? "(no name submitted)"}</p>
              <p className="text-sm text-muted-foreground">
                Provider: {row.providerName ?? "—"} · Completion year: {row.completionYear ?? "—"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {masterCourses.map((mc) => (
                  <form key={mc.id} action={approveCourseCompletion.bind(null, row.id, mc.id)}>
                    <button
                      type="submit"
                      className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                    >
                      Link to &ldquo;{mc.name}&rdquo;
                    </button>
                  </form>
                ))}
                <form action={rejectCourseCompletion.bind(null, row.id)}>
                  <button
                    type="submit"
                    className="rounded-md border border-destructive px-3 py-1 text-sm text-destructive hover:bg-destructive/10"
                  >
                    Reject
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
