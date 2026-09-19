"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestDataExport, type RequestExportResult } from "./actions";

export function ExportForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RequestExportResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const outcome = await requestDataExport(email);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) setEmail("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">
        Assembles a JSON export of the user&apos;s own data and emails them a 24-hour download
        link (§8H).
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="export-email">
          User&apos;s email
        </Label>
        <Input
          id="export-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Requesting…" : "Send data export"}
      </Button>
      {result && !result.ok && <p className="text-sm text-destructive">{result.error}</p>}
      {result?.ok && <p className="text-sm text-muted-foreground">Export queued — the user will receive an email shortly.</p>}
    </form>
  );
}
