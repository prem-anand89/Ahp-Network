"use client";

// §8E3 — "Admin, freely," [H3] no density gate. A slug is derived from the
// name automatically rather than asking the admin to invent one, matching
// the same generate-then-dedupe pattern src/lib/onboarding.ts uses for
// profile slugs.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCommunityAction } from "./actions";

export function CreateCommunityForm() {
  const [open, setOpen] = useState(false);

  async function handleCreate(formData: FormData) {
    const name = (formData.get("name") as string).trim();
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    await createCommunityAction({ name, slug });
    setOpen(false);
    window.location.reload();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        New community
      </Button>
    );
  }

  return (
    <form action={handleCreate} className="flex flex-col gap-3 rounded-md border p-4">
      <Label htmlFor="community-name" className="sr-only">Community name</Label>
      <Input
        id="community-name"
        name="name"
        required
        placeholder="Community name (e.g. Pediatric Neuro Rehab AHPs)"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Create</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
