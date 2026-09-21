"use client";

// §10C step 2/2.5/3. Phase 2 polish: a step dot-strip (not a progress
// bar — the plan rejects that framing everywhere it appears; onboarding
// is no exception), a back button between steps, and persistence across
// an accidental reload mid-flow. Progress is kept in sessionStorage
// (same per-tab-ephemeral choice app/app/error.tsx already made for
// similar reasons) rather than written to the server: the only server
// write is submitProfileStep2 itself, unchanged — going "back" never
// re-submits, it just re-shows state already held client-side.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { AreaSelector } from "@/components/areas/area-selector";
import { ProfileCard } from "@/components/cards/profile-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localityContextLine } from "@/lib/copy";
import { ROLE_NEEDED_LABELS } from "@/lib/referral-labels";
import { submitProfileStep2, markLocalityContextShown } from "./actions";
import type { AreaZone } from "@/lib/areas";
import type { LocalityContext, ProfileStep2Input } from "@/lib/onboarding";

const ROLE_OPTIONS = Object.entries(ROLE_NEEDED_LABELS).map(([value, label]) => ({ value, label }));

type Role = NonNullable<ProfileStep2Input["role"]>;
type Step = 2 | 2.5 | 3;
const STEPS: Step[] = [2, 2.5, 3];

const STORAGE_KEY = "ahp_onboarding_progress";

interface StoredProgress {
  step: Step;
  displayName: string;
  role: Role | "";
  areaIds: string[];
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
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-pill ${i <= currentIndex ? "bg-primary" : "bg-muted"}`}
          />
        ))}
      </div>
    </div>
  );
}

export function OnboardingFlow({ zones }: { zones: AreaZone[] }) {
  const [step, setStep] = useState<Step>(2);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localityContext, setLocalityContext] = useState<LocalityContext | null>(null);

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
    setAreaIds(stored.areaIds);
    setLocalityContext(stored.localityContext);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    writeStoredProgress({ step, displayName, role, areaIds, localityContext });
  }, [step, displayName, role, areaIds, localityContext]);

  const areaName = zones.flatMap((z) => z.localities).find((l) => l.id === areaIds[0])?.name ?? undefined;

  async function handleContinue() {
    setError(null);
    if (!displayName.trim() || !role || areaIds.length === 0) {
      setError("Fill in all three fields to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const context = await submitProfileStep2({ displayName: displayName.trim(), role, areaId: areaIds[0] });
      setLocalityContext(context);
      setStep(2.5);
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

  if (step === 2) {
    return (
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          handleContinue();
        }}
      >
        <StepDots current={step} />

        {/* §10C step 2 — the live preview updates as these three fields change, before any further data entry. */}
        <ProfileCard
          slug={null}
          displayName={displayName || null}
          photoUrl={null}
          role={role || null}
          specializations={[]}
          verificationStage="unverified"
          localityLabel={areaName}
          capacityState="not_taking"
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
          <span className="text-sm font-medium">Your locality</span>
          <AreaSelector zones={zones} value={areaIds} onChange={setAreaIds} max={1} />
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

        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </form>
    );
  }

  if (step === 2.5) {
    return (
      <div className="flex flex-col gap-4">
        <StepDots current={step} />
        <button
          type="button"
          onClick={() => setStep(2)}
          className="flex h-11 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Back
        </button>
        <p className="text-base">
          {localityContext ? localityContextLine(localityContext.count, localityContext.isFoundingCohortFraming) : ""}
        </p>
        <Button onClick={handleLocalityContinue}>Continue</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <StepDots current={step} />
      <button
        type="button"
        onClick={() => setStep(2.5)}
        className="flex h-11 w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back
      </button>
      <p className="text-sm text-muted-foreground">
        Browse these now — claiming one needs a credential check (2 minutes, one photo).
      </p>
      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link href="/app/dashboard">See what&apos;s happening on the network</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/referrals">Browse the referral board</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/verification">Upload a credential</Link>
        </Button>
      </div>
    </div>
  );
}
