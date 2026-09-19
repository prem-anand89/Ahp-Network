"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
        <Label htmlFor="target-email">
          Email (must have signed in at least once)
        </Label>
        <Input
          id="target-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@example.com"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="role-select">
          Role
        </Label>
        <Select
          value={role}
          onValueChange={(val) => setRole(val as AdminRoleType)}
        >
          <SelectTrigger id="role-select" className="w-[200px]">
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Assigning…" : "Assign role"}
      </Button>
      {result && !result.ok && <p className="w-full text-sm text-destructive">{result.error}</p>}
    </form>
  );
}
