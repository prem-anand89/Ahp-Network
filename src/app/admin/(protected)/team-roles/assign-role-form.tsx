"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { assignRoleAction, type ActionResult } from "./actions";
import type { AdminRoleType } from "@/lib/admin-roles";

const ROLE_OPTIONS: AdminRoleType[] = [
  "super_admin",
  "verification_admin",
  "grievance_officer",
  "support_admin",
  "referral_ops_admin",
  "technical_admin",
];

export function AssignRoleForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRoleType>("verification_admin");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const outcome = await assignRoleAction(email, role);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) setEmail("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="target-email" className="text-sm font-medium">
          Email (must have signed in at least once)
        </label>
        <input
          id="target-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="person@example.com"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="role-select" className="text-sm font-medium">
          Role
        </label>
        <select
          id="role-select"
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRoleType)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Assigning…" : "Assign role"}
      </Button>
      {result && !result.ok && <p className="w-full text-sm text-destructive">{result.error}</p>}
    </form>
  );
}
