// The referral card — G9's other hero surface, and the referral board's
// core unit (built for real in Phase 6). Hierarchy locked by
// ARCHITECTURE_REVIEW.md G10: specialty and urgency are primary; locality
// and visit type secondary; age bracket and time posted tertiary. On a
// mid-tier Android at 360px this ordering is what decides whether "simple"
// actually holds.
//
// Structured fields only — never patient_summary free text on this
// surface (plan §9's Network Activity feed rule, followed here too since
// the card is shared).

import { AlertTriangle, Clock, Home, MapPin, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ReferralUrgency = "urgent" | "routine";
export type ReferralVisitType = "home" | "clinic";

export interface ReferralCardProps {
  specialtyLabel: string;
  urgency: ReferralUrgency;
  localityLabel: string;
  visitType: ReferralVisitType;
  /**
   * home_case_referrals has no structured age-bracket column (only
   * patient_summary free text, which this structured-fields-only card
   * never surfaces) — omit this tertiary field rather than deriving it
   * from free text.
   */
  ageBracketLabel?: string;
  postedLabel: string;
  /** §8D's displayFor() output — the plain-language state line (§G1: never a countdown for the poster). */
  stateLabel?: string;
  stateDetail?: string;
  /** Only rendered when the viewer actually matches (plan §9's Network Activity feed rule). */
  onExpressInterest?: () => void;
  /** Non-interactive state for a non-matching viewer — a label, never a greyed-out button. */
  nonMatchLabel?: string;
}

export function ReferralCard({
  specialtyLabel,
  urgency,
  localityLabel,
  visitType,
  ageBracketLabel,
  postedLabel,
  stateLabel,
  stateDetail,
  onExpressInterest,
  nonMatchLabel,
}: ReferralCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 shadow-sm">
      {/* Primary: specialty + urgency */}
      <div className="flex items-start justify-between gap-2.5">
        <span className="text-base font-semibold text-card-foreground">{specialtyLabel}</span>
        {urgency === "urgent" && (
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-[color:var(--destructive)]/10 px-2.5 py-1">
            <AlertTriangle className="size-3.5 text-[color:var(--destructive)]" aria-hidden />
            <span className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--destructive)]">
              Urgent
            </span>
          </span>
        )}
      </div>

      {/* Secondary: locality + visit type */}
      <div className="flex flex-wrap items-center gap-3.5 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MapPin className="size-3.5" aria-hidden />
          {localityLabel}
        </span>
        <span className="flex items-center gap-1.5">
          {visitType === "home" ? (
            <Home className="size-3.5" aria-hidden />
          ) : (
            <Building2 className="size-3.5" aria-hidden />
          )}
          {visitType === "home" ? "Home visit" : "Clinic visit"}
        </span>
      </div>

      {/* Tertiary: age bracket (when available) + time posted */}
      <div className="flex items-center justify-between border-t pt-2.5">
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
          {ageBracketLabel && <span className="rounded-full bg-muted px-2 py-0.5">{ageBracketLabel}</span>}
          <span className="flex items-center gap-1">
            <Clock className="size-3" aria-hidden />
            {postedLabel}
          </span>
        </div>

        {onExpressInterest ? (
          <Button size="sm" onClick={onExpressInterest}>
            Express interest
          </Button>
        ) : (
          nonMatchLabel && <span className="text-xs text-muted-foreground">{nonMatchLabel}</span>
        )}
      </div>

      {stateLabel && (
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className="font-medium text-card-foreground">{stateLabel}</span>
          {stateDetail && <span className="text-muted-foreground">— {stateDetail}</span>}
        </div>
      )}
    </div>
  );
}
