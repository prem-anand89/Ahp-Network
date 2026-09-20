// Phase 3 — practice profiles. The backend (practices, practice_users,
// practice_claims, actions.ts) predates this UI and was entirely orphaned
// — this is the missing entry point: the practices a therapist is
// affiliated with, plus a way to find/create one.

import Link from "next/link";
import { Building2 } from "lucide-react";
import { and, eq, isNull } from "drizzle-orm";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { practices, practiceUsers } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { OwnershipVerifiedBadge } from "@/components/badges/verification-badge";

export const dynamic = "force-dynamic";

const PRACTICE_TYPE_LABELS: Record<string, string> = {
  clinic: "Clinic",
  hospital_department: "Hospital department",
  home_care_agency: "Home care agency",
  wellness_center: "Wellness center",
  other: "Practice",
};

export default async function PracticesPage() {
  const userId = await getVerifiedUserId();
  if (!userId) return null;

  const db = await getDb();
  const myPractices = await db
    .select({
      id: practices.id,
      name: practices.name,
      type: practices.type,
      slug: practices.slug,
      formattedAddress: practices.formattedAddress,
      claimStatus: practices.claimStatus,
      claimedAt: practices.claimedAt,
      accessRole: practiceUsers.accessRole,
    })
    .from(practiceUsers)
    .innerJoin(practices, eq(practices.id, practiceUsers.practiceId))
    .where(
      and(
        eq(practiceUsers.userId, userId),
        eq(practiceUsers.consentStatus, "accepted"),
        isNull(practiceUsers.endedAt),
        isNull(practiceUsers.deletedAt),
        isNull(practices.deletedAt),
      ),
    );

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your practices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Clinics, hospital departments, and other practices you&apos;re affiliated with.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/app/practices/new" prefetch={false}>Add a practice</Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {myPractices.length === 0 && (
          <EmptyState
            icon={<Building2 className="size-6" aria-hidden />}
            title="No practices yet"
            body="Add the clinic or practice you work at — it's a listing anyone can add, and the owner can later claim it with documentation."
            action={
              <Link href="/app/practices/new" prefetch={false} className="text-sm font-semibold hover:underline">
                Add a practice
              </Link>
            }
          />
        )}
        {myPractices.map((practice) => (
          <Card key={practice.id} className="flex-row items-center justify-between gap-4 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {PRACTICE_TYPE_LABELS[practice.type] ?? "Practice"}
              </p>
              <p className="font-medium">{practice.name}</p>
              {practice.formattedAddress && (
                <p className="text-sm text-muted-foreground">{practice.formattedAddress}</p>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                {practice.claimStatus === "claimed" ? (
                  <OwnershipVerifiedBadge dateLabel={practice.claimedAt?.toLocaleDateString("en-IN") ?? ""} />
                ) : (
                  <span className="text-xs text-muted-foreground">Unclaimed listing</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              {practice.slug && (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/clinic/${practice.slug}`} prefetch={false}>View public page</Link>
                </Button>
              )}
              {["owner", "manager"].includes(practice.accessRole) ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/practices/${practice.id}/edit`} prefetch={false}>Edit</Link>
                </Button>
              ) : practice.claimStatus === "unclaimed" ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/practices/${practice.id}/claim`} prefetch={false}>Claim ownership</Link>
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
