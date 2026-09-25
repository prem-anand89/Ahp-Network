"use client";

// §8D/§8D2 — the referral posting form. Visit type and the consent
// checkbox are both required, un-preselected choices (same discipline,
// same reason: a pre-filled answer to a question that changes who gets
// notified, or whether patient data flows at all, is not really an
// answer). Urgency reason is required only when urgency = 'urgent'.
//
// Round 3 step D — "Where is the patient?" replaces the old Hyderabad-
// only AreaSelector with the national CityPicker/LocalityPicker: the
// referral's location is the PATIENT's, not the poster's, and can be any
// city in India (plan §3). Defaults to the poster's own base city, since
// that's the common case, but is always changeable.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { CityPicker, type CitySelection } from "@/components/areas/city-picker";
import { LocalityPicker, type LocalitySelection } from "@/components/areas/locality-picker";
import { getCityAreaTreeAction } from "@/app/app/areas/actions";
import { postReferral, previewMatch } from "../actions";
import { pledgeForCity } from "@/app/app/pledges/actions";
import { ShareInviteActions } from "@/app/app/verification/share-invite-actions";
import { cityWideToggleLabel, PATIENT_SUMMARY_PLACEHOLDER, PATIENT_SUMMARY_WARNING, REFERRAL_CONSENT_TEXT } from "@/lib/copy";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import { PLEDGE_THRESHOLD } from "@/lib/pledge-options";
import type { CircleWithCount } from "@/lib/circles";
import type { CommunitySummary } from "@/lib/communities";
import type { PreviewMatchResult } from "@/lib/referral-actions";

const ROLE_OPTIONS = Object.entries(ROLE_NEEDED_LABELS).map(([value, label]) => ({ value, label }));
const SPECIALIZATION_OPTIONS = Object.entries(SPECIALIZATION_LABELS).map(([value, label]) => ({ value, label }));

/** The Select below encodes its options as "circle:{id}" / "community:{id}"
 * — one native control instead of two, matching every other single-choice
 * field on this form. A prefilled therapist target skips the picker
 * entirely (the choice was already made by tapping "Refer Patient" on
 * their profile) and is kept even for urgent — postReferralTx now allows
 * urgent + a therapist-only target in a locked city (Round 3 step E's
 * "direct offer to one named therapist" exception) and otherwise rejects
 * it with a clear error, so the client shouldn't silently discard the
 * poster's actual choice before the server even sees it. A circle/
 * community target from the picker below is still dropped for urgent —
 * postReferralTx unconditionally rejects that combination, no exception. */
function resolveFirstLookTarget(
  urgency: "routine" | "urgent",
  prefillTherapist: PrefillTherapist | undefined,
  rawValue: string | null,
): { type: "circle" | "community" | "therapist"; id: string } | undefined {
  if (prefillTherapist) return { type: "therapist", id: prefillTherapist.id };
  if (urgency === "urgent") return undefined;
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
  initialCity,
  circles,
  communities,
  prefillTherapist,
}: {
  /** The poster's own base city (from getMyCoverageTx), the common-case
   * default for "where is the patient" — always changeable. Null for a
   * poster with no coverage on file yet (shouldn't normally happen for
   * an active therapist, but the picker still works with no default). */
  initialCity: CitySelection | null;
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
  // visitType/location.
  const [roleNeeded, setRoleNeeded] = useState("");
  const [specializationNeeded, setSpecializationNeeded] = useState("");
  const [city, setCity] = useState<CitySelection | null>(initialCity);
  const [changingCity, setChangingCity] = useState(false);
  const [locality, setLocality] = useState<LocalitySelection | null>(null);
  const [zoneOptions, setZoneOptions] = useState<{ id: string; name: string }[]>([]);
  // Which city zoneOptions was actually fetched for — lets the render
  // below tell "this city genuinely has no zones" apart from "haven't
  // heard back yet" (both look like an empty array otherwise), and
  // avoids showing the previous city's zones for a beat after changing
  // city (picking one would then fail server-side — the locality
  // wouldn't belong to that zone).
  const [zoneOptionsCityId, setZoneOptionsCityId] = useState<string | null>(null);
  const [visitType, setVisitType] = useState<"home" | "clinic" | null>(null);
  // Review item #1 — clinic-visit only (enforced by resetting this to
  // false whenever visitType switches to "home", and again server-side
  // by the DB CHECK home_case_referrals_area_scope_home_visit).
  const [cityWide, setCityWide] = useState(false);
  const [urgency, setUrgency] = useState<"routine" | "urgent">("routine");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [matchPreview, setMatchPreview] = useState<PreviewMatchResult | null>(null);
  const [pledging, setPledging] = useState(false);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [pledgedCities, setPledgedCities] = useState<Set<string>>(new Set());

  // The zone list backs LocalityPicker's "can't find it" propose flow
  // (decision D3 — a proposed locality must be filed under a zone, or
  // whole-zone coverage can never reach it). Fetch-on-city-change, same
  // shape as area-coverage-picker.tsx's CityCoverageBlock effect — a
  // genuine fetch-on-mount/prop-change, not fetch-on-keystroke, so a
  // plain useEffect is the right tool here (not the onChange-triggered
  // pattern city-picker.tsx/locality-picker.tsx use for search-as-you-type).
  useEffect(() => {
    // No synchronous "clear to []" branch: when city is null, LocalityPicker
    // isn't rendered at all, so a stale zoneOptions value from a
    // previously-picked city sits harmlessly unused rather than needing a
    // setState call the react-hooks/set-state-in-effect rule flags.
    if (!city) return;
    let cancelled = false;
    getCityAreaTreeAction(city.id).then((tree) => {
      if (!cancelled) {
        setZoneOptions(tree.zones.map((z) => ({ id: z.id, name: z.name })));
        setZoneOptionsCityId(city.id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [city]);

  // Derived, not stored: true only once zoneOptions actually belongs to
  // the currently-picked city. Rendered below.
  const zoneOptionsReady = city !== null && zoneOptionsCityId === city.id;

  // Live pool preview — "N therapists match" — recomputed whenever the
  // fields that actually feed matching change, once they're all set.
  // Deliberately a useEffect (not onChange-triggered): this reacts to
  // several already-known pieces of form state settling, not to
  // keystrokes in a text input. previewReady is derived straight from
  // render state (never stored), so the "not ready yet" case needs no
  // setState call — only the resolved fetch result does, inside .then().
  const previewReady = Boolean(
    roleNeeded && specializationNeeded && visitType !== null && ((cityWide && city) || (!cityWide && locality)),
  );
  useEffect(() => {
    if (!previewReady) return;
    let cancelled = false;
    previewMatch({
      roleNeeded: roleNeeded as never,
      specializationNeeded: specializationNeeded as never,
      homeVisitRequired: visitType === "home",
      areaScope: cityWide ? "city" : "locality",
      areaId: cityWide ? undefined : locality?.id,
      cityAreaId: cityWide ? city?.id : undefined,
      targetTherapistId: prefillTherapist?.id,
    }).then((result) => {
      if (!cancelled) setMatchPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [previewReady, roleNeeded, specializationNeeded, visitType, cityWide, city, locality, prefillTherapist]);

  // Round 3 step E — pledging from right here, not a separate page: this
  // is the moment a locked city's absence is actually felt. Purely
  // additive to the count shown (getCityProgress already recomputes it
  // fresh); pledgedCities just avoids a disabled-forever button if the
  // count itself doesn't visibly change (e.g. this poster already based
  // there, already counted).
  async function handlePledge(cityAreaId: string) {
    setPledgeError(null);
    setPledging(true);
    try {
      await pledgeForCity(cityAreaId);
      setPledgedCities((prev) => new Set(prev).add(cityAreaId));
    } catch (e) {
      setPledgeError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPledging(false);
    }
  }

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
    if (visitType === null) {
      setError("Choose whether this is a home visit or clinic visit.");
      return;
    }
    if (!cityWide && !locality) {
      setError("Choose the patient's locality.");
      return;
    }
    if (cityWide && !city) {
      setError("Choose the patient's city.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await postReferral({
        roleNeeded: roleNeeded as never,
        specializationNeeded: specializationNeeded as never,
        areaId: cityWide ? undefined : locality?.id,
        cityAreaId: cityWide ? city?.id : undefined,
        areaScope: cityWide ? "city" : "locality",
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

      {/* [E5]/CLAUDE.md — no default, un-preselected. Deciding who gets notified.
          Moved ahead of Locality: whether "patient can travel" is even
          offered depends on this choice (review item #1 — city-wide is
          clinic-visit only, a therapist travelling to the patient is
          inherently locality-bound). */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Visit type</legend>
        <RadioGroup
          value={visitType ?? undefined}
          onValueChange={(v) => {
            setVisitType(v as "home" | "clinic");
            if (v === "home") setCityWide(false);
          }}
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

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Where is the patient?</span>

        {!city || changingCity ? (
          <CityPicker
            onSelect={(c) => {
              setCity(c);
              setLocality(null);
              setChangingCity(false);
            }}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
              <span>{city.name}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setChangingCity(true)}
              >
                Change city
              </button>
            </div>

            {visitType === "clinic" && (
              <Label htmlFor="cityWide" className="items-start gap-2 text-sm leading-normal font-normal">
                <Checkbox
                  id="cityWide"
                  checked={cityWide}
                  onCheckedChange={(v) => setCityWide(v === true)}
                  className="mt-0.5"
                />
                {cityWideToggleLabel(city.name)}
              </Label>
            )}

            {!cityWide &&
              (!locality ? (
                <LocalityPicker
                  cityAreaId={city.id}
                  cityName={city.name}
                  onSelect={setLocality}
                  // Only require a zone once we've actually confirmed the
                  // city's own zone list — otherwise (still loading, or a
                  // brief window right after switching city) this falls
                  // back to a zoneless propose rather than either forcing
                  // a stale previous city's zones on the user or leaving
                  // "Use this name" disabled with no way to proceed.
                  requireZoneOptions={zoneOptionsReady ? zoneOptions : undefined}
                />
              ) : (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span>{locality.name}</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => setLocality(null)}
                  >
                    Change
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {previewReady && matchPreview && !matchPreview.cityUnlocked && !prefillTherapist && (
        <div className="rounded-md border p-3 text-sm">
          <p>
            {matchPreview.cityName} isn&apos;t open for public referrals yet — refer directly to a therapist, a
            circle, or a community you trust instead (First Look, below), or help unlock it.
          </p>
          <p className="mt-1 text-muted-foreground">
            {matchPreview.cityPledgeCount ?? 0} of {PLEDGE_THRESHOLD} pledged.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pledging || pledgedCities.has(matchPreview.cityAreaId)}
              onClick={() => handlePledge(matchPreview.cityAreaId)}
            >
              {pledgedCities.has(matchPreview.cityAreaId) ? "Pledged" : "Pledge to help unlock"}
            </Button>
            <ShareInviteActions />
          </div>
          {pledgeError && <p className="mt-1 text-destructive">{pledgeError}</p>}
        </div>
      )}

      {previewReady && matchPreview && matchPreview.cityUnlocked && (
        <p className="text-sm text-muted-foreground">
          {matchPreview.count === 0
            ? "No therapists match yet — try clinic visits with “anywhere in the city,” or refer directly to someone you know."
            : `${matchPreview.count} therapist${matchPreview.count === 1 ? "" : "s"} match this so far.`}
          {matchPreview.targetMatches === false && (
            <span className="block text-destructive">
              This therapist doesn&apos;t match this referral&apos;s role, specialization, area or visit type, isn&apos;t verified yet, or isn&apos;t taking referrals right now.
            </span>
          )}
        </p>
      )}

      {previewReady && matchPreview && !matchPreview.cityUnlocked && prefillTherapist && matchPreview.targetMatches === false && (
        <p className="text-sm text-destructive">
          This therapist doesn&apos;t match this referral&apos;s role, specialization, area or visit type, isn&apos;t verified yet, or isn&apos;t taking referrals right now.
        </p>
      )}

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
          urgent when picked from the circle/community list below
          (postReferralTx rejects that combination unconditionally — an
          urgent case held back for a group is a patient-harm vector, not
          a feature). A prefilled therapist target (arrived via a
          profile's "Refer Patient" button) is different: Round 3 step E
          allows urgent + a therapist-only target, but only in a locked
          city (no First Look window at all, offered immediately) — in an
          unlocked city the server still refuses it, since there the full
          pool is reachable and holding an urgent case for one person is
          exactly the risk First Look was refused for. matchPreview
          already knows which case this is. */}
      {prefillTherapist && (
        <div className="rounded-md border p-3 text-sm">
          {urgency === "routine" ? (
            <>
              First Look: offered to <span className="font-medium">{prefillTherapist.displayName}</span> first,
              then everyone else who matches.
            </>
          ) : matchPreview && !matchPreview.cityUnlocked ? (
            <>
              Offered immediately to <span className="font-medium">{prefillTherapist.displayName}</span> only — no
              First Look window, since {matchPreview.cityName} isn&apos;t open for public referrals yet.
            </>
          ) : (
            <span className="text-destructive">
              An urgent referral can&apos;t be held for one person once the matched pool is reachable — switch back
              to Routine to target {prefillTherapist.displayName} specifically, or leave this as Urgent to notify
              everyone who matches.
            </span>
          )}
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
