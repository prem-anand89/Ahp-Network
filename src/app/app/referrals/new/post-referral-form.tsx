"use client";

// §8D/§8D2 — the referral posting form. Visit type and the consent
// checkbox are both required, un-preselected choices (same discipline,
// same reason: a pre-filled answer to a question that changes who gets
// notified, or whether patient data flows at all, is not really an
// answer). Urgency reason is required only when urgency = 'urgent'.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AreaSelector } from "@/components/areas/area-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { postReferral } from "../actions";
import { PATIENT_SUMMARY_PLACEHOLDER, PATIENT_SUMMARY_WARNING, REFERRAL_CONSENT_TEXT } from "@/lib/copy";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import type { AreaZone } from "@/lib/areas";

const ROLE_OPTIONS = Object.entries(ROLE_NEEDED_LABELS).map(([value, label]) => ({ value, label }));
const SPECIALIZATION_OPTIONS = Object.entries(SPECIALIZATION_LABELS).map(([value, label]) => ({ value, label }));

export function PostReferralForm({ zones }: { zones: AreaZone[] }) {
  const router = useRouter();
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [visitType, setVisitType] = useState<"home" | "clinic" | null>(null);
  const [urgency, setUrgency] = useState<"routine" | "urgent">("routine");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    if (visitType === null) {
      setError("Choose whether this is a home visit or clinic visit.");
      return;
    }
    if (areaIds.length === 0) {
      setError("Choose the locality this referral is for.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await postReferral({
        roleNeeded: formData.get("roleNeeded") as never,
        specializationNeeded: formData.get("specializationNeeded") as never,
        areaId: areaIds[0],
        homeVisitRequired: visitType === "home",
        urgency,
        urgencyReason: (formData.get("urgencyReason") as string) || undefined,
        additionalContext: (formData.get("additionalContext") as string) || undefined,
        patientSummary: formData.get("patientSummary") as string,
        consentAccepted,
      });
      router.push(`/app/referrals/${result.referralId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form action={handleSubmit} className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="roleNeeded">Role needed</Label>
        <Select name="roleNeeded" required defaultValue={ROLE_OPTIONS[0]?.value}>
          <SelectTrigger id="roleNeeded" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="specializationNeeded">Specialization needed</Label>
        <Select name="specializationNeeded" required defaultValue={SPECIALIZATION_OPTIONS[0]?.value}>
          <SelectTrigger id="specializationNeeded" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPECIALIZATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Locality</span>
        <AreaSelector zones={zones} value={areaIds} onChange={setAreaIds} max={1} />
      </div>

      {/* [E5]/CLAUDE.md — no default, un-preselected. Deciding who gets notified. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Visit type</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="visitType"
              checked={visitType === "home"}
              onChange={() => setVisitType("home")}
            />
            Home visit
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="visitType"
              checked={visitType === "clinic"}
              onChange={() => setVisitType("clinic")}
            />
            Clinic visit
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Urgency</legend>
        <p className="text-xs text-muted-foreground">
          &quot;Urgent&quot; means the patient needs to start soon, not a medical emergency.
        </p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="urgency"
              checked={urgency === "routine"}
              onChange={() => setUrgency("routine")}
            />
            Routine
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="urgency"
              checked={urgency === "urgent"}
              onChange={() => setUrgency("urgent")}
            />
            Urgent
          </label>
        </div>
        {urgency === "urgent" && (
          <Input
            name="urgencyReason"
            required
            placeholder="Why is this urgent? (admins only, never shown to therapists)"
            className="mt-1"
          />
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="patientSummary">Patient summary</Label>
        <p className="text-xs font-medium text-[color:var(--destructive)]">{PATIENT_SUMMARY_WARNING}</p>
        <Textarea
          id="patientSummary"
          name="patientSummary"
          required
          placeholder={PATIENT_SUMMARY_PLACEHOLDER}
          rows={3}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="additionalContext">
          Anything else to share? (optional, shown to matched therapists)
        </Label>
        <Textarea id="additionalContext" name="additionalContext" rows={2} />
      </div>

      {/* §8D2 — mandatory, un-prechecked, blocks creation entirely. */}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consentAccepted}
          onChange={(e) => setConsentAccepted(e.target.checked)}
          className="mt-0.5"
        />
        {REFERRAL_CONSENT_TEXT}
      </label>

      {error && <p className="text-sm text-[color:var(--destructive)]">{error}</p>}

      <Button type="submit" disabled={submitting || !consentAccepted}>
        {submitting ? "Posting…" : "Post referral"}
      </Button>
    </form>
  );
}
