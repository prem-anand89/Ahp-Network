"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { revokeRoleAction } from "./actions";

export function RevokeRoleButton({ roleAssignmentId }: { roleAssignmentId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const result = await revokeRoleAction(roleAssignmentId);
    setPending(false);
    if (!result.ok) setError(result.error ?? "Failed to revoke role");
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
