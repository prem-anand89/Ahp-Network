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
import { postReferral } from "../actions";
import {
  CIRCLE_TARGETED_EMPTY_INTERSECTION_WARNING,
  PATIENT_SUMMARY_PLACEHOLDER,
  PATIENT_SUMMARY_WARNING,
  REFERRAL_CONSENT_TEXT,
} from "@/lib/copy";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import type { AreaZone } from "@/lib/areas";
import type { CircleWithCount } from "@/lib/circles";

const ROLE_OPTIONS = Object.entries(ROLE_NEEDED_LABELS).map(([value, label]) => ({ value, label }));
const SPECIALIZATION_OPTIONS = Object.entries(SPECIALIZATION_LABELS).map(([value, label]) => ({ value, label }));

export function PostReferralForm({ zones, circles }: { zones: AreaZone[]; circles: CircleWithCount[] }) {
  const router = useRouter();
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [visitType, setVisitType] = useState<"home" | "clinic" | null>(null);
  const [urgency, setUrgency] = useState<"routine" | "urgent">("routine");
  const [consentAccepted, setConsentAccepted] = useState(false);
  // Execution-plan Phase 4 — un-preselected once a circle exists to pick,
  // same discipline as visit type/consent above: a pre-filled choice
  // about who gets notified is not really an answer.
  const [targetingMode, setTargetingMode] = useState<"open" | "circle">("open");
  const [targetCircleId, setTargetCircleId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Posted successfully, but a circle with zero currently-matching members
  // — the referral exists and the widening sweep will eventually reach the
  // rest of the pool, but this is worth telling the poster now rather than
  // silently landing on a referral page with no interest rows at all.
  const [postedWithEmptyIntersection, setPostedWithEmptyIntersection] = useState<string | null>(null);

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
    if (targetingMode === "circle" && !targetCircleId) {
      setError("Choose which circle to send this referral to.");
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
        targetingMode,
        targetCircleId: targetingMode === "circle" ? targetCircleId : undefined,
      });
      if (result.emptyIntersectionWarning) {
        setPostedWithEmptyIntersection(result.referralId);
      } else {
        router.push(`/app/referrals/${result.referralId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (postedWithEmptyIntersection) {
    return (
      <div className="flex max-w-xl flex-col gap-3 rounded-md border p-4">
        <p className="text-sm font-medium">{CIRCLE_TARGETED_EMPTY_INTERSECTION_WARNING}</p>
        <Button asChild size="sm" className="self-start">
          <a href={`/app/referrals/${postedWithEmptyIntersection}`}>View referral</a>
        </Button>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="roleNeeded" className="text-sm font-medium">
          Role needed
        </label>
        <select id="roleNeeded" name="roleNeeded" required className="rounded-md border bg-background px-3 py-2 text-sm">
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="specializationNeeded" className="text-sm font-medium">
          Specialization needed
        </label>
        <select
          id="specializationNeeded"
          name="specializationNeeded"
          required
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          {SPECIALIZATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
          <input
            name="urgencyReason"
            required
            placeholder="Why is this urgent? (admins only, never shown to therapists)"
            className="mt-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="patientSummary" className="text-sm font-medium">
          Patient summary
        </label>
        <p className="text-xs font-medium text-[color:var(--destructive)]">{PATIENT_SUMMARY_WARNING}</p>
        <textarea
          id="patientSummary"
          name="patientSummary"
          required
          placeholder={PATIENT_SUMMARY_PLACEHOLDER}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          rows={3}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="additionalContext" className="text-sm font-medium">
          Anything else to share? (optional, shown to matched therapists)
        </label>
        <textarea
          id="additionalContext"
          name="additionalContext"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          rows={2}
        />
      </div>

      {circles.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium">Who should see this?</legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="targetingMode"
                checked={targetingMode === "open"}
                onChange={() => setTargetingMode("open")}
              />
              Everyone matching
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="targetingMode"
                checked={targetingMode === "circle"}
                onChange={() => setTargetingMode("circle")}
              />
              Just one of my circles
            </label>
          </div>
          {targetingMode === "circle" && (
            <select
              name="targetCircleId"
              value={targetCircleId}
              onChange={(e) => setTargetCircleId(e.target.value)}
              className="mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose a circle
              </option>
              {circles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </fieldset>
      )}

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
