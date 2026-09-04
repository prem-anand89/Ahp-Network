import { VerifyForm } from "./verify-form";

export default function AdminVerifyPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-xl font-semibold">Re-verify to enter admin mode</h1>
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        For security, entering admin mode requires confirming it&rsquo;s really you — even though
        you&rsquo;re already signed in.
      </p>
      <VerifyForm />
    </div>
  );
}
