import { FeedbackForm } from "./feedback-form";

export default function FeedbackPage() {
  return (
    <main className="mx-auto max-w-lg space-y-6 p-6">
      <h1 className="text-xl font-semibold">Feedback</h1>
      <FeedbackForm />
    </main>
  );
}
