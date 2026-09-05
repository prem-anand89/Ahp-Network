"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
        <label htmlFor="export-email" className="text-sm font-medium">
          User&apos;s email
        </label>
        <input
          id="export-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
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
