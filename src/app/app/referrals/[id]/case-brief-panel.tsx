"use client";

// Phase 4 — the case brief panel. Write-once form for the poster right
// after acceptance; a read-only display once written, visible to the
// poster and the accepting therapist only (never the wider matched pool
// — see can-view-case-brief.ts's same discipline as patient_summary).
// No replies, no attachments, no new notification — see case-brief.ts's
// header for why a message thread was rejected.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CASE_BRIEF_WARNING,
  CASE_BRIEF_FIELD_PLACEHOLDERS,
  CASE_BRIEF_NO_PRECAUTIONS_TEXT,
  CASE_BRIEF_NO_PRECAUTIONS_TOGGLE_LABEL,
  CASE_BRIEF_PRECAUTION_TAGS,
  CASE_BRIEF_CONTACT_METHOD_OPTIONS,
  CASE_BRIEF_CONTACT_TIME_PLACEHOLDER,
} from "@/lib/copy";
import type { CaseBrief, CaseBriefInput } from "@/lib/case-brief";
import { writeCaseBrief } from "../actions";

const FIELD_ORDER: { key: keyof CaseBriefInput; label: string }[] = [
  { key: "reasonForReferral", label: "Reason for referral" },
  { key: "relevantHistory", label: "Relevant history" },
  { key: "expectedGoal", label: "Primary goal / expected outcome" },
  { key: "precautions", label: "Precautions" },
  { key: "preferredContactWindow", label: "Preferred contact window" },
];

// Step 7F — free text, not any of the plain fields above: precautions
// gets an "All-Clear" toggle (hides the textarea, writes a fixed value)
// plus quick-insert tags, and the contact window is really two inputs
// (method + time) composed into the one existing column at submit —
// nothing downstream that reads preferredContactWindow needs to change.
function CaseBriefForm({ referralId }: { referralId: string }) {
  const router = useRouter();
  const [reasonForReferral, setReasonForReferral] = useState("");
  const [relevantHistory, setRelevantHistory] = useState("");
  const [expectedGoal, setExpectedGoal] = useState("");
  const [noPrecautions, setNoPrecautions] = useState(false);
  const [precautions, setPrecautions] = useState("");
  const [contactMethod, setContactMethod] = useState<string>(CASE_BRIEF_CONTACT_METHOD_OPTIONS[0]);
  const [contactTime, setContactTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const precautionsRef = useRef<HTMLTextAreaElement>(null);

  function insertTag(tag: string) {
    const el = precautionsRef.current;
    if (!el) {
      setPrecautions((v) => (v ? `${v}, ${tag}` : tag));
      return;
    }
    const start = el.selectionStart ?? precautions.length;
    const end = el.selectionEnd ?? precautions.length;
    const next = precautions.slice(0, start) + tag + precautions.slice(end);
    setPrecautions(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await writeCaseBrief(referralId, {
        reasonForReferral,
        relevantHistory,
        expectedGoal,
        precautions: noPrecautions ? CASE_BRIEF_NO_PRECAUTIONS_TEXT : precautions,
        preferredContactWindow: contactTime.trim() ? `${contactMethod} · ${contactTime.trim()}` : contactMethod,
      });
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="case-brief-reasonForReferral">Reason for referral</Label>
          <Textarea
            id="case-brief-reasonForReferral"
            rows={2}
            maxLength={300}
            value={reasonForReferral}
            onChange={(e) => setReasonForReferral(e.target.value)}
            placeholder={CASE_BRIEF_FIELD_PLACEHOLDERS.reasonForReferral}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="case-brief-relevantHistory">Relevant history</Label>
          <Textarea
            id="case-brief-relevantHistory"
            rows={2}
            maxLength={300}
            value={relevantHistory}
            onChange={(e) => setRelevantHistory(e.target.value)}
            placeholder={CASE_BRIEF_FIELD_PLACEHOLDERS.relevantHistory}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="case-brief-expectedGoal">Primary goal / expected outcome</Label>
          <Textarea
            id="case-brief-expectedGoal"
            rows={2}
            maxLength={300}
            value={expectedGoal}
            onChange={(e) => setExpectedGoal(e.target.value)}
            placeholder={CASE_BRIEF_FIELD_PLACEHOLDERS.expectedGoal}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="case-brief-no-precautions">{CASE_BRIEF_NO_PRECAUTIONS_TOGGLE_LABEL}</Label>
            <Switch id="case-brief-no-precautions" checked={noPrecautions} onCheckedChange={setNoPrecautions} />
          </div>
          {!noPrecautions && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {CASE_BRIEF_PRECAUTION_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="rounded-pill border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <Textarea
                id="case-brief-precautions"
                ref={precautionsRef}
                rows={2}
                maxLength={300}
                value={precautions}
                onChange={(e) => setPrecautions(e.target.value)}
                placeholder={CASE_BRIEF_FIELD_PLACEHOLDERS.precautions}
                required
              />
            </>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Preferred contact window</Label>
          <div className="flex gap-2">
            <Select value={contactMethod} onValueChange={setContactMethod}>
              <SelectTrigger className="w-40 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_BRIEF_CONTACT_METHOD_OPTIONS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={contactTime}
              onChange={(e) => setContactTime(e.target.value)}
              placeholder={CASE_BRIEF_CONTACT_TIME_PLACEHOLDER}
              maxLength={280}
              className="flex-1"
            />
          </div>
        </div>
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
