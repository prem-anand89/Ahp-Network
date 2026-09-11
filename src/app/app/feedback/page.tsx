import { FeedbackForm } from "./feedback-form";

// force-dynamic per page, not on the shared /app/* layout — see the
// comment on that layout for why. This is the exact page that motivated
// putting the check at the layout level in the first place (a client-form
// page with no dynamic API call of its own silently qualifies for static
// generation); it still needs its own declaration now that dynamic lives
// per-page.
export const dynamic = "force-dynamic";

export default function FeedbackPage() {
  return (
    <main className="mx-auto max-w-lg space-y-6 p-6">
      <h1 className="text-xl font-semibold">Feedback</h1>
      <FeedbackForm />
    </main>
  );
}
