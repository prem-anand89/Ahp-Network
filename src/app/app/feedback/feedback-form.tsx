"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback, type SubmitFeedbackResult } from "./actions";
import type { FeedbackCategory } from "@/lib/feedback";

const CATEGORY_OPTIONS: { value: Exclude<FeedbackCategory, "verification_issue">; label: string }[] = [
  { value: "bug", label: "Something's broken" },
  { value: "feature_request", label: "Feature request" },
  { value: "content_issue", label: "Content issue" },
  { value: "grievance", label: "Formal grievance" },
  { value: "other", label: "Other" },
];

export function FeedbackForm() {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [message, setMessage] = useState("");
  const [contactOk, setContactOk] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SubmitFeedbackResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    const outcome = await submitFeedback(category, message, contactOk);
    setPending(false);
    setResult(outcome);
    if (outcome.ok) {
      setMessage("");
      setContactOk(false);
    }
  }

  if (result?.ok) {
    return <p className="text-sm text-muted-foreground">Thanks — this has been logged.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A concern about your credentials or verification status? Use the{" "}
        <Link href="/app/verification" className="underline">
          verification page
        </Link>{" "}
        instead — this form is for everything else.
      </p>

      <div className="flex flex-col gap-1">
        <Label htmlFor="feedback-category">
          Category
        </Label>
        <Select
          value={category}
          onValueChange={(val) => setCategory(val as FeedbackCategory)}
        >
          <SelectTrigger id="feedback-category">
            <SelectValue placeholder="Select a category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="feedback-message">
          Message
        </Label>
        <Textarea
          id="feedback-message"
          required
          minLength={5}
          maxLength={4000}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <Label className="flex items-center gap-2 font-normal">
        <input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} />
        It&apos;s ok to contact me about this
      </Label>

      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit"}
      </Button>

      {result && !result.ok && <p className="text-sm text-destructive">{result.error}</p>}
    </form>
  );
}
