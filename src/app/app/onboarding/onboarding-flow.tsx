"use client";

import { useState } from "react";
import Link from "next/link";
import { AreaSelector } from "@/components/areas/area-selector";
import { ProfileCard } from "@/components/cards/profile-card";
import { Button } from "@/components/ui/button";
import { localityContextLine } from "@/lib/copy";
import { ROLE_NEEDED_LABELS } from "@/lib/referral-labels";
import { submitProfileStep2, markLocalityContextShown } from "./actions";
import type { AreaZone } from "@/lib/areas";
import type { LocalityContext, ProfileStep2Input } from "@/lib/onboarding";

const ROLE_OPTIONS = Object.entries(ROLE_NEEDED_LABELS).map(([value, label]) => ({ value, label }));

type Role = NonNullable<ProfileStep2Input["role"]>;

export function OnboardingFlow({ zones }: { zones: AreaZone[] }) {
  const [step, setStep] = useState<2 | 2.5 | 3>(2);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [areaIds, setAreaIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localityContext, setLocalityContext] = useState<LocalityContext | null>(null);

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
      <div className="flex flex-col gap-6">
        {/* §10C step 2 — the live preview updates as these three fields change, before any further data entry. */}
        <ProfileCard
          slug={null}
          displayName={displayName || null}
          photoUrl={null}
          role={role || null}
          specializations={[]}
          verificationStage="unverified"
          localityLabel={areaName}
          availableForNewPatients={false}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="displayName" className="text-sm font-medium">
            Your name
          </label>
          <input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="e.g. Priya Nair"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="role" className="text-sm font-medium">
            Your role
          </label>
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Choose one</option>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Your locality</span>
          <AreaSelector zones={zones} value={areaIds} onChange={setAreaIds} max={1} />
        </div>

        {error && <p className="text-sm text-[color:var(--destructive)]">{error}</p>}

        <Button onClick={handleContinue} disabled={submitting}>
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    );
  }

  if (step === 2.5) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-base">
          {localityContext ? localityContextLine(localityContext.count, localityContext.isFoundingCohortFraming) : ""}
        </p>
        <Button onClick={handleLocalityContinue}>Continue</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
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
