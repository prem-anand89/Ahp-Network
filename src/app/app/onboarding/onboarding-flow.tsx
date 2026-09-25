"use client";

// §10C step 2/2.5/3. Phase 2 polish: a step dot-strip (not a progress
// bar — the plan rejects that framing everywhere it appears; onboarding
// is no exception), a back button between steps, and persistence across
// an accidental reload mid-flow. Progress is kept in sessionStorage
// (same per-tab-ephemeral choice app/app/error.tsx already made for
// similar reasons) rather than written to the server: the only server
// write is submitProfileStep2 itself, unchanged — going "back" never
// re-submits, it just re-shows state already held client-side.
//
// Round 3 step C — step 2 is now three short national screens (city,
// base locality, coverage) instead of one Hyderabad-only chip grid. The
// waitlist fallback (CityPledgeFallback, the "Not in Hyderabad?" branch)
// is retired: signing up from any city now works the same way, unlocking
// only the open referral pool later (Step E), never onboarding itself.
//
// Step 7B — the profile screen also captures up to 3 specialties and an
// accepting-patients answer (both already existed as profile fields,
// previously only reachable later from the dashboard checklist). Step 2.5
// became Suggested Connections: up to 3 same-city verified therapists to
// add to a Circle, plus 1 community to join — a random draw, never
// sorted by any count (§1A). Step 3 makes "Upload a credential" the one
// primary action; skipping is a quiet text link, not an equal button.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CityPicker, type CitySelection } from "@/components/areas/city-picker";
import { LocalityPicker, type LocalitySelection } from "@/components/areas/locality-picker";
import { AreaCoveragePicker, type CoverageSelection } from "@/components/areas/area-coverage-picker";
import { ProfileCard } from "@/components/cards/profile-card";
import { AddToCircleButton } from "@/components/circles/add-to-circle-button";
import { PushOptIn } from "@/components/push-opt-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localityContextLine } from "@/lib/copy";
import { ROLE_NEEDED_LABELS, SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import { submitProfileStep2, markLocalityContextShown, getSuggestedConnectionsAction } from "./actions";
import { joinCommunityAction } from "@/app/app/communities/actions";
import type { LocalityContext, SuggestedConnections } from "@/lib/onboarding";
import type { SpecializationType } from "@/db/schema";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS = Object.entries(ROLE_NEEDED_LABELS).map(([value, label]) => ({ value, label }));
const SPECIALIZATION_OPTIONS = Object.entries(SPECIALIZATION_LABELS).map(([value, label]) => ({ value, label }));
const MAX_ONBOARDING_SPECIALIZATIONS = 3;

type Role = "physiotherapist" | "occupational_therapist" | "speech_language_pathologist";

type Step = "profile" | "city" | "locality" | "coverage" | 2.5 | 3;
const STEPS: Step[] = ["profile", "city", "locality", "coverage", 2.5, 3];

const STORAGE_KEY = "ahp_onboarding_progress";

interface StoredProgress {
  step: Step;
  displayName: string;
  role: Role | "";
  specializations: string[];
  acceptingNewPatients: boolean;
  city: CitySelection | null;
  baseArea: LocalitySelection | null;
  coverage: CoverageSelection[];
  localityContext: LocalityContext | null;
}

function readStoredProgress(): StoredProgress | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredProgress;
  } catch {
    return null;
  }
}

function writeStoredProgress(progress: StoredProgress): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Private browsing / storage disabled — onboarding still works, it
    // just won't survive a reload. Not worth surfacing an error for.
  }
}

function StepDots({ current }: { current: Step }) {
  const currentIndex = STEPS.indexOf(current);
  return (
    <div className="flex items-center gap-1.5">
      <span className="sr-only">
        Step {currentIndex + 1} of {STEPS.length}
      </span>
      <div className="flex flex-1 items-center gap-1.5" role="presentation" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} className={`h-1.5 flex-1 rounded-pill ${i <= currentIndex ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden />
      Back
    </button>
  );
}

export function OnboardingFlow() {
  const [step, setStep] = useState<Step>("profile");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [acceptingNewPatients, setAcceptingNewPatients] = useState(true);
  const [city, setCity] = useState<CitySelection | null>(null);
  const [baseArea, setBaseArea] = useState<LocalitySelection | null>(null);
  const [coverage, setCoverage] = useState<CoverageSelection[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localityContext, setLocalityContext] = useState<LocalityContext | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedConnections | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Client-only hydration from sessionStorage — deliberately not read in
  // the initial useState (that would run during SSR, where sessionStorage
  // doesn't exist) or a lazy initializer with a window guard (that still
  // risks a hydration mismatch against the server-rendered blank state).
  // A mount-only effect means the first paint always matches the server,
  // then progress restores a frame later — a non-issue for a form nobody
  // reads before interacting with. react-hooks/set-state-in-effect exists
  // to catch effects that re-derive state React already owns; this one
  // reads an external system (sessionStorage) exactly once on mount, which
  // is the pattern the rule's own guidance calls legitimate.
  /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration
     from an external system (sessionStorage) on mount, not a re-derivation
     of state React already owns. */
  useEffect(() => {
    const stored = readStoredProgress();
    if (!stored) return;
    setStep(stored.step);
    setDisplayName(stored.displayName);
    setRole(stored.role);
    setSpecializations(stored.specializations ?? []);
    setAcceptingNewPatients(stored.acceptingNewPatients ?? true);
    setCity(stored.city);
    setBaseArea(stored.baseArea);
    setCoverage(stored.coverage);
    setLocalityContext(stored.localityContext);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    writeStoredProgress({
      step,
      displayName,
      role,
      specializations,
      acceptingNewPatients,
      city,
      baseArea,
      coverage,
      localityContext,
    });
  }, [step, displayName, role, specializations, acceptingNewPatients, city, baseArea, coverage, localityContext]);

  // Guards against a corrupted/partial sessionStorage restore landing on a
  // step whose prerequisite state is missing (e.g. "coverage" with no
  // city) — falls back a step rather than crashing on a null dereference.
  // Same category as the hydration effect above: correcting for an
  // external system's (sessionStorage's) state, not re-deriving state
  // React already owns from props.
  /* eslint-disable react-hooks/set-state-in-effect -- corrects a
     corrupted sessionStorage restore, not a re-derivation of owned state. */
  useEffect(() => {
    if (step === "locality" && !city) setStep("city");
    if (step === "coverage" && (!city || !baseArea)) setStep(city ? "locality" : "city");
  }, [step, city, baseArea]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A reload that restores directly onto step 2.5 (sessionStorage doesn't
  // persist `suggestions` — it's a fresh random draw, not durable state)
  // needs its own fetch, since handleSubmitCoverage above only fires on
  // the forward transition into this step. This is a data fetch from an
  // external system (the server action), not a re-derivation of state
  // React already owns — the pattern the rule's own guidance calls
  // legitimate, same category as the two hydration effects above.
  /* eslint-disable react-hooks/set-state-in-effect -- fetches suggestions
     from the server on a direct-load/reload into step 2.5, not a
     re-derivation of owned state. */
  useEffect(() => {
    if (step !== 2.5 || !city || suggestions || suggestionsLoading) return;
    setSuggestionsLoading(true);
    getSuggestedConnectionsAction(city.id)
      .then(setSuggestions)
      .catch(() => setSuggestions({ therapists: [], community: null }))
      .finally(() => setSuggestionsLoading(false));
  }, [step, city, suggestions, suggestionsLoading]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function selectCity(selected: CitySelection) {
    setCity(selected);
    // A fresh city pick invalidates whatever locality/coverage belonged
    // to the previous one.
    setBaseArea(null);
    setCoverage([]);
    setStep("locality");
  }

  function selectBaseArea(selected: LocalitySelection) {
    if (!city) return;
    setBaseArea(selected);
    setCoverage([{ cityAreaId: city.id, areaId: selected.id, tier: "primary" }]);
    setStep("coverage");
  }

  async function handleSubmitCoverage() {
    if (!baseArea) return;
    setError(null);
    setSubmitting(true);
    try {
      const context = await submitProfileStep2({
        displayName: displayName.trim(),
        role: role as NonNullable<Role>,
        baseAreaId: baseArea.id,
        coverage,
        specializations: specializations as SpecializationType[],
        acceptingNewPatients,
      });
      setLocalityContext(context);
      setStep(2.5);
      if (city) {
        setSuggestionsLoading(true);
        getSuggestedConnectionsAction(city.id)
          .then(setSuggestions)
          .catch(() => setSuggestions({ therapists: [], community: null }))
          .finally(() => setSuggestionsLoading(false));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLocalityContinue() {
    await markLocalityContextShown().catch(() => {});
    setStep(3);
  }

  function toggleSpecialization(value: string) {
    setSpecializations((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= MAX_ONBOARDING_SPECIALIZATIONS) return prev;
      return [...prev, value];
    });
  }

  const localityLabel = baseArea ? `${baseArea.name}, ${city?.name ?? ""}` : undefined;

  if (step === "profile") {
    return (
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!displayName.trim() || !role) {
            setError("Fill in your name and role to continue.");
            return;
          }
          setStep("city");
        }}
      >
        <StepDots current={step} />

        {/* §10C step 2 — the live preview updates as these fields change, before any further data entry. */}
        <ProfileCard
          slug={null}
          displayName={displayName || null}
          photoUrl={null}
          role={role || null}
          specializations={specializations}
          verificationStage="unverified"
          localityLabel={localityLabel}
          capacityState={acceptingNewPatients ? "available" : "not_taking"}
          availabilityUpdatedAt={null}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="displayName">Your name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Priya Nair"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">Your role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="role" className="w-full">
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
          <Label>
            Your specialties{" "}
            <span className="font-normal text-muted-foreground">
              (up to {MAX_ONBOARDING_SPECIALIZATIONS}, optional)
            </span>
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {SPECIALIZATION_OPTIONS.map((o) => {
              const selected = specializations.includes(o.value);
              const disabled = !selected && specializations.length >= MAX_ONBOARDING_SPECIALIZATIONS;
              return (
                <button
                  key={o.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleSpecialization(o.value)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-pill border px-3 py-1.5 text-sm font-medium transition-colors",
                    selected
                      ? "border-primary bg-secondary text-secondary-foreground"
                      : disabled
                        ? "border-border text-muted-foreground/50"
                        : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Accepting new patients?</p>
            <p className="text-xs text-muted-foreground">You can change this any time from your profile.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={acceptingNewPatients ? "default" : "outline"}
            onClick={() => setAcceptingNewPatients((v) => !v)}
            aria-pressed={acceptingNewPatients}
          >
            {acceptingNewPatients ? "Yes" : "Not right now"}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">
          By continuing, you agree to the{" "}
          <Link href="/legal/founding-declaration" target="_blank" className="underline">
            Founding Member Declaration
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy-notice" target="_blank" className="underline">
            Interim Data &amp; Privacy Notice
          </Link>
          .
        </p>

        <Button type="submit">Continue</Button>
      </form>
    );
  }

  if (step === "city") {
    return (
      <div className="flex flex-col gap-4">
        <StepDots current={step} />
        <BackButton onClick={() => setStep("profile")} />
        <div>
          <h2 className="text-base font-medium">Your city</h2>
          <p className="text-sm text-muted-foreground">Where are you based?</p>
        </div>
        <CityPicker onSelect={selectCity} autoFocus />
      </div>
    );
  }

  if (step === "locality") {
    if (!city) return null;
    return (
      <div className="flex flex-col gap-4">
        <StepDots current={step} />
        <BackButton onClick={() => setStep("city")} />
        <div>
          <h2 className="text-base font-medium">Your base locality</h2>
          <p className="text-sm text-muted-foreground">Where in {city.name} do you usually see patients?</p>
        </div>
        <LocalityPicker cityAreaId={city.id} cityName={city.name} onSelect={selectBaseArea} autoFocus />
      </div>
    );
  }

  if (step === "coverage") {
    if (!city || !baseArea) return null;
    return (
      <div className="flex flex-col gap-4">
        <StepDots current={step} />
        <BackButton onClick={() => setStep("locality")} />
        <div>
          <h2 className="text-base font-medium">Where you do home visits</h2>
          <p className="text-sm text-muted-foreground">Tick every area you&apos;ll take referrals in.</p>
        </div>
        <AreaCoveragePicker primaryCity={city} baseAreaId={baseArea.id} value={coverage} onChange={setCoverage} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={handleSubmitCoverage} disabled={submitting}>
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    );
  }

  if (step === 2.5) {
    return (
      <div className="flex flex-col gap-4">
        <StepDots current={step} />
        <BackButton onClick={() => setStep("coverage")} />
        <p className="text-base">
          {localityContext ? localityContextLine(localityContext.count, localityContext.isFoundingCohortFraming) : ""}
        </p>

        {suggestionsLoading && <p className="text-sm text-muted-foreground">Finding people near you…</p>}

        {suggestions && suggestions.therapists.length > 0 && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">People near you</h2>
            {suggestions.therapists.map((t) => (
              <div key={t.userId} className="flex items-center justify-between rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.displayName ?? "A therapist"}</p>
                  {t.role && (
                    <p className="text-xs text-muted-foreground">
                      {ROLE_NEEDED_LABELS[t.role] ?? t.role}
                    </p>
                  )}
                </div>
                <AddToCircleButton therapistUserId={t.userId} />
              </div>
            ))}
          </div>
        )}

        {suggestions?.community && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">A community to join</h2>
            <JoinCommunityRow community={suggestions.community} />
          </div>
        )}

        <Button onClick={handleLocalityContinue}>Continue</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StepDots current={step} />
      <BackButton onClick={() => setStep(2.5)} />
      <div className="rounded-md border p-4">
        <p className="mb-2 text-sm font-medium">Never miss a referral</p>
        <PushOptIn />
      </div>
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="h-14 text-base">
          <Link href="/app/verification">Upload a credential &amp; verify</Link>
        </Button>
        <p className="text-center text-xs text-muted-foreground">2 minutes, one photo of your registration or degree.</p>
        <Button asChild variant="outline">
          <Link href="/app/referrals">Browse the referral board</Link>
        </Button>
        <Link
          href="/app/dashboard"
          className="text-center text-sm text-muted-foreground underline hover:text-foreground"
        >
          Skip to dashboard
        </Link>
      </div>
    </div>
  );
}

function JoinCommunityRow({ community }: { community: { id: string; name: string; slug: string } }) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);

  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <Link href={`/app/communities/${community.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
        {community.name}
      </Link>
      <Button
        type="button"
        size="sm"
        variant={joined ? "outline" : "default"}
        disabled={joining || joined}
        onClick={async () => {
          setJoining(true);
          try {
            await joinCommunityAction(community.id);
            setJoined(true);
          } finally {
            setJoining(false);
          }
        }}
      >
        {joined ? "Joined" : joining ? "Joining…" : "Join"}
      </Button>
    </div>
  );
}
