"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sendAdminVerifyCode, verifyAdminCode } from "./actions";

export function VerifyForm() {
  const [step, setStep] = useState<"request" | "code">("request");
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleRequestCode() {
    setError(null);
    setPending(true);
    const result = await sendAdminVerifyCode();
    setPending(false);
    if (result.error) {
      setError(result.error);
    } else {
      setEmail(result.email ?? null);
      setStep("code");
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setError(null);
    setPending(true);
    const result = await verifyAdminCode(email, code);
    setPending(false);
    if (result?.error) setError(result.error);
  }

  if (step === "request") {
    return (
      <div className="w-full max-w-sm space-y-3">
        <Button onClick={handleRequestCode} disabled={pending} className="w-full">
          {pending ? "Sending…" : "Send verification code"}
        </Button>
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="w-full max-w-sm space-y-3">
      <label className="block text-sm font-medium" htmlFor="admin-code">
        6-digit code sent to {email}
      </label>
      <input
        id="admin-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm tracking-widest"
        placeholder="123456"
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Verifying…" : "Enter admin mode"}
      </Button>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </form>
  );
}
