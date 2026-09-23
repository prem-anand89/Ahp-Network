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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { postReferral } from "../actions";
import { PATIENT_SUMMARY_PLACEHOLDER, PATIENT_SUMMARY_WARNING, REFERRAL_CONSENT_TEXT } from "@/lib/copy";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import type { AreaZone } from "@/lib/areas";
import type { CircleWithCount } from "@/lib/circles";
import type { CommunitySummary } from "@/lib/communities";

const ROLE_OPTIONS = Object.entries(ROLE_NEEDED_LABELS).map(([value, label]) => ({ value, label }));
const SPECIALIZATION_OPTIONS = Object.entries(SPECIALIZATION_LABELS).map(([value, label]) => ({ value, label }));

/** The Select below encodes its options as "circle:{id}" / "community:{id}"
 * — one native control instead of two, matching every other single-choice
 * field on this form. A prefilled therapist target skips the picker
 * entirely (the choice was already made by tapping "Refer Patient" on
 * their profile), and postReferralTx itself rejects urgent + a target
 * regardless of what the client sends. */
function resolveFirstLookTarget(
  urgency: "routine" | "urgent",
  prefillTherapist: PrefillTherapist | undefined,
  rawValue: string | null,
): { type: "circle" | "community" | "therapist"; id: string } | undefined {
  if (urgency === "urgent") return undefined;
  if (prefillTherapist) return { type: "therapist", id: prefillTherapist.id };
  if (!rawValue) return undefined;
  const [type, id] = rawValue.split(":");
  if (type === "circle" || type === "community") return { type, id };
  return undefined;
}

/** Round 2 — First Look prefilled from the profile "Refer Patient" CTA
 * (plan decision 7): the poster still goes through this same form and
 * the same matching/shortlist/accept path, just arriving with one
 * therapist already chosen as the target instead of picking a circle or
 * community. */
export interface PrefillTherapist {
  id: string;
  displayName: string;
}

export function PostReferralForm({
  zones,
  circles,
  communities,
  prefillTherapist,
}: {
  zones: AreaZone[];
  circles: CircleWithCount[];
  communities: CommunitySummary[];
  prefillTherapist?: PrefillTherapist;
}) {
  const router = useRouter();
  // [Review, 2026-09-21] roleNeeded/specializationNeeded used to carry a
  // defaultValue (first option, pre-selected) — the one field CLAUDE.md
  // calls "the single query the whole product depends on" had no un-
  // preselected discipline, unlike visitType two fields below. A poster
  // who never touched either dropdown would silently post into the wrong
  // matched pool. Now un-preselected and explicitly validated, same as
  // visitType/areaIds.
  const [roleNeeded, setRoleNeeded] = useState("");
  const [specializationNeeded, setSpecializationNeeded] = useState("");
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [visitType, setVisitType] = useState<"home" | "clinic" | null>(null);
  const [urgency, setUrgency] = useState<"routine" | "urgent">("routine");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setError(null);
    if (!roleNeeded) {
      setError("Choose the role needed.");
      return;
    }
    if (!specializationNeeded) {
      setError("Choose the specialization needed.");
      return;
    }
    if (areaIds.length === 0) {
      setError("Choose the locality this referral is for.");
      return;
    }
    if (visitType === null) {
      setError("Choose whether this is a home visit or clinic visit.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await postReferral({
        roleNeeded: roleNeeded as never,
        specializationNeeded: specializationNeeded as never,
        areaId: areaIds[0],
        homeVisitRequired: visitType === "home",
        urgency,
        urgencyReason: (formData.get("urgencyReason") as string) || undefined,
        additionalContext: (formData.get("additionalContext") as string) || undefined,
        patientSummary: formData.get("patientSummary") as string,
        consentAccepted,
        firstLookTarget: resolveFirstLookTarget(urgency, prefillTherapist, formData.get("firstLookTarget") as string | null),
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
        <Select value={roleNeeded} onValueChange={setRoleNeeded}>
          <SelectTrigger id="roleNeeded" className="w-full">
            <SelectValue placeholder="Choose one" />
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
        <Select value={specializationNeeded} onValueChange={setSpecializationNeeded}>
          <SelectTrigger id="specializationNeeded" className="w-full">
            <SelectValue placeholder="Choose one" />
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
        <RadioGroup
          value={visitType ?? undefined}
          onValueChange={(v) => setVisitType(v as "home" | "clinic")}
          className="flex gap-4"
        >
          <Label htmlFor="visitType-home" className="min-h-11 font-normal">
            <RadioGroupItem value="home" id="visitType-home" />
            Home visit
          </Label>
          <Label htmlFor="visitType-clinic" className="min-h-11 font-normal">
            <RadioGroupItem value="clinic" id="visitType-clinic" />
            Clinic visit
          </Label>
        </RadioGroup>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Urgency</legend>
        <p className="text-xs text-muted-foreground">
          &quot;Urgent&quot; means the patient needs to start soon, not a medical emergency.
        </p>
        <RadioGroup
          value={urgency}
          onValueChange={(v) => setUrgency(v as "routine" | "urgent")}
          className="flex gap-4"
        >
          <Label htmlFor="urgency-routine" className="min-h-11 font-normal">
            <RadioGroupItem value="routine" id="urgency-routine" />
            Routine
          </Label>
          <Label htmlFor="urgency-urgent" className="min-h-11 font-normal">
            <RadioGroupItem value="urgent" id="urgency-urgent" />
            Urgent
          </Label>
        </RadioGroup>
        {urgency === "urgent" && (
          <Input
            name="urgencyReason"
            required
            placeholder="Why is this urgent? (admins only, never shown to therapists)"
            className="mt-1"
          />
        )}
      </fieldset>

      {/* Round 2 (First Look) — "I'd ask Raghav first," encoded honestly:
          an explicit choice, not an algorithm. Disabled entirely for
          urgent (postReferralTx also rejects this server-side — an
          urgent case held back for one person or group is a patient-harm
          vector, not a feature). A prefilled therapist target (arrived
          via a profile's "Refer Patient" button) replaces this picker
          with a fixed statement — that choice was already made. */}
      {urgency === "routine" && prefillTherapist && (
        <div className="rounded-md border p-3 text-sm">
          First Look: offered to <span className="font-medium">{prefillTherapist.displayName}</span> first, then
          everyone else who matches.
        </div>
      )}
      {urgency === "routine" && !prefillTherapist && (circles.length > 0 || communities.length > 0) && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="firstLookTarget">First Look — ask someone first (optional)</Label>
          <p className="text-xs text-muted-foreground">
            For 4 hours, only they see it — then it opens to everyone who matches, same as normal.
          </p>
          <Select name="firstLookTarget">
            <SelectTrigger id="firstLookTarget" className="w-full">
              <SelectValue placeholder="No one — notify everyone who matches" />
            </SelectTrigger>
            <SelectContent>
              {circles.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Circles</SelectLabel>
                  {circles.map((c) => (
                    <SelectItem key={c.id} value={`circle:${c.id}`}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {communities.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Communities</SelectLabel>
                  {communities.map((c) => (
                    <SelectItem key={c.id} value={`community:${c.id}`}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="patientSummary">Patient summary</Label>
        <p className="text-xs font-medium text-destructive">{PATIENT_SUMMARY_WARNING}</p>
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
      <Label htmlFor="consentAccepted" className="items-start gap-2 text-sm leading-normal font-normal">
        <Checkbox
          id="consentAccepted"
          checked={consentAccepted}
          onCheckedChange={(v) => setConsentAccepted(v === true)}
          className="mt-0.5"
        />
        {REFERRAL_CONSENT_TEXT}
      </Label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting || !consentAccepted}>
        {submitting ? "Posting…" : "Post referral"}
      </Button>
    </form>
  );
}
