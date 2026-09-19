"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runErasureRequest, type RunErasureResult } from "./actions";

export function ErasureForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RunErasureResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) return;
    setPending(true);
    setResult(null);
    const outcome = await runErasureRequest(email);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) {
      setEmail("");
      setConfirmed(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">
        Irreversible (§8H). Only run this against a real, verified erasure request — never as a
        test against a real account.
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="erasure-email">
          User&apos;s email
        </Label>
        <Input
          id="erasure-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Label className="flex items-center gap-2 font-normal">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I have confirmed this is a real erasure request and this action cannot be undone
      </Label>
      <Button
        type="submit"
        variant="outline"
        className="border-destructive text-destructive hover:bg-destructive/10"
        disabled={pending || !confirmed}
      >
        {pending ? "Erasing…" : "Run erasure"}
      </Button>
      {result && !result.ok && <p className="text-sm text-destructive">{result.error}</p>}
      {result?.ok && (
        <p className="text-sm text-muted-foreground">
          Done — {result.result?.credentialsAnonymised} credential(s), {result.result?.referralsAnonymised}{" "}
          referral(s), {result.result?.practiceClaimsAnonymised} practice claim(s) anonymised.
        </p>
      )}
    </form>
  );
}
