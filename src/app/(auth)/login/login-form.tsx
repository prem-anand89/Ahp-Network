"use client";

// §4 — Google OAuth + email OTP. On mobile the 6-digit code is presented
// as the primary path (with a note that the same email also has a
// click-through link); on desktop the framing flips, but the interactive
// code-verification flow is otherwise identical — Supabase Auth's
// signInWithOtp email includes both by default.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signInWithGoogle, sendOtpCode, verifyOtpCode } from "./actions";

export function LoginForm({
  mobileFirst,
  nextPath,
  authError,
}: {
  mobileFirst: boolean;
  nextPath?: string;
  authError?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(authError ?? null);
  const [pending, setPending] = useState(false);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await sendOtpCode(email);
    setPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setStep("code");
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await verifyOtpCode(email, code, nextPath);
    setPending(false);
    if (result?.error) setError(result.error);
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <h1 className="text-center text-2xl font-semibold">Sign in to AHP Network</h1>

      <form action={signInWithGoogle.bind(null, nextPath)}>
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      {step === "email" && (
        <form onSubmit={handleSendCode} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="you@example.com"
          />
          <p className="text-xs text-muted-foreground">
            {mobileFirst
              ? "We'll email you a 6-digit code."
              : "We'll email you a sign-in link — the same email also has a 6-digit code if you'd rather use that."}
          </p>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending…" : "Send code"}
          </Button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={handleVerifyCode} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="code">
            6-digit code
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm tracking-widest"
            placeholder="123456"
          />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Verifying…" : "Verify and sign in"}
          </Button>
        </form>
      )}

      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
