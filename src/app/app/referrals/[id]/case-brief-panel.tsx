"use client";

// Phase 4 — the case brief panel. Write-once form for the poster right
// after acceptance; a read-only display once written, visible to the
// poster and the accepting therapist only (never the wider matched pool
// — see can-view-case-brief.ts's same discipline as patient_summary).
// No replies, no attachments, no new notification — see case-brief.ts's
// header for why a message thread was rejected.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CASE_BRIEF_WARNING, CASE_BRIEF_FIELD_PLACEHOLDERS } from "@/lib/copy";
import type { CaseBrief, CaseBriefInput } from "@/lib/case-brief";
import { writeCaseBrief } from "../actions";

const FIELD_ORDER: { key: keyof CaseBriefInput; label: string }[] = [
  { key: "reasonForReferral", label: "Reason for referral" },
  { key: "relevantHistory", label: "Relevant history" },
  { key: "precautions", label: "Precautions" },
  { key: "preferredContactWindow", label: "Preferred contact window" },
];

function CaseBriefForm({ referralId }: { referralId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<CaseBriefInput>({
    reasonForReferral: "",
    relevantHistory: "",
    precautions: "",
    preferredContactWindow: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await writeCaseBrief(referralId, values);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Add a case brief for the accepting therapist</h3>
      <p className="mt-1 text-xs font-medium text-destructive">{CASE_BRIEF_WARNING}</p>
      <div className="mt-3 flex flex-col gap-3">
        {FIELD_ORDER.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`case-brief-${key}`}>{label}</Label>
            <Textarea
              id={`case-brief-${key}`}
              rows={2}
              maxLength={300}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              placeholder={CASE_BRIEF_FIELD_PLACEHOLDERS[key]}
              required
            />
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" loading={submitting} className="mt-3">
        Save case brief
      </Button>
    </form>
  );
}

function CaseBriefDisplay({ brief }: { brief: CaseBrief }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Case brief</h3>
      <dl className="mt-2 flex flex-col gap-2">
        {FIELD_ORDER.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
            <dd className="text-sm">{brief[key]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CaseBriefPanel({
  referralId,
  referralStatus,
  isPoster,
  isAccepter,
  caseBrief,
}: {
  referralId: string;
  referralStatus: string;
  isPoster: boolean;
  isAccepter: boolean;
  caseBrief: CaseBrief | null;
}) {
  if (referralStatus !== "accepted" && !caseBrief) return null;
  if (!isPoster && !isAccepter) return null;

  if (caseBrief) return <CaseBriefDisplay brief={caseBrief} />;
  if (isPoster) return <CaseBriefForm referralId={referralId} />;

  // Accepter, referral accepted, no brief yet — an explicit wait state
  // rather than nothing, since a receiving therapist might otherwise
  // wonder if this feature exists at all.
  return (
    <div className="rounded-lg border border-dashed p-4">
      <p className="text-sm text-muted-foreground">
        The poster hasn&apos;t added a case brief yet — check back, or reach them directly.
      </p>
    </div>
  );
}
