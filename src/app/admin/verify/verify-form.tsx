"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <Label htmlFor="admin-code">
        Verification code sent to {email}
      </Label>
      <Input
        id="admin-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="tracking-widest"
        placeholder="Enter the code from your email"
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Verifying…" : "Enter admin mode"}
      </Button>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </form>
  );
}
