// §9 — the public directory. Filters narrow the result set only; the
// sort order (verified tier, availability recency, completeness, random
// tiebreak — src/lib/directory.ts) is unconditional. A GET form driving
// searchParams keeps this server-rendered with no client JS, matching
// the (public) route group's static-first approach — the page itself is
// dynamic per query (expected for a filtered listing), the shared layout
// stays free of any cookies()/headers() call.

import type { Metadata } from "next";
import { Search } from "lucide-react";
import { getDb } from "@/db/db";
import { getAreaZones } from "@/lib/areas";
import { searchDirectory, type DirectoryFilters, type ExperienceBucket } from "@/lib/directory";
import { ProfileCard } from "@/components/cards/profile-card";
import { SITE_METADATA } from "@/lib/site-metadata";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import { directoryResultsLine } from "@/lib/copy";
import { getVerifiedUserId } from "@/lib/supabase/server";

// The directory's first-ever metadata export — it's the primary SEO
// target and previously inherited the root title verbatim (Phase 1
// step 12). No per-query metadata (searchParams-driven titles aren't
// worth the added complexity at pilot scale); this is the static shell
// every filtered view shares.
export const metadata: Metadata = {
  title: "Directory",
  description:
    "Browse verified physiotherapists, occupational therapists, and speech-language " +
    "pathologists in Hyderabad. Every listed profile is reviewed by a person before it's public.",
  openGraph: {
    title: `Directory | ${SITE_METADATA.name}`,
    description:
      "Browse verified physiotherapists, occupational therapists, and speech-language " +
      "pathologists in Hyderabad.",
    url: `${SITE_METADATA.url}/directory`,
    siteName: SITE_METADATA.name,
    type: "website",
  },
};

// Deliberately dynamic (not a silent leak): this page reads searchParams
// for live filtering, which Next.js can never statically prerender or
// meaningfully ISR-cache (each distinct query string is effectively its
// own page). scripts/check-public-routes-static.mjs treats this explicit
// declaration as a different case from an accidental cookies()/headers()
// leak — the thing that check actually guards against.
export const dynamic = "force-dynamic";

const ROLE_OPTIONS = [
  { value: "physiotherapist", label: "Physiotherapist" },
  { value: "occupational_therapist", label: "Occupational Therapist" },
  { value: "speech_language_pathologist", label: "Speech-Language Pathologist" },
] as const;

// Phase 2 taxonomy expansion — derived from SPECIALIZATION_LABELS rather
// than hardcoded, so this filter list can't drift from the schema again.
const SPECIALIZATION_OPTIONS = Object.entries(SPECIALIZATION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const AGE_GROUP_OPTIONS = [
  { value: "pediatric", label: "Pediatric" },
  { value: "adult", label: "Adult" },
  { value: "geriatric", label: "Geriatric" },
] as const;

const EXPERIENCE_OPTIONS: { value: ExperienceBucket; label: string }[] = [
  { value: "0-2", label: "0–2 years" },
  { value: "3-5", label: "3–5 years" },
  { value: "6-10", label: "6–10 years" },
  { value: "10+", label: "10+ years" },
];

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

const VISIT_LABELS: Record<string, string> = {
  home: "Home visit",
  clinic: "Clinic visit",
};

function param(searchParams: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

interface ActiveFilterChip {
  key: string;
  label: string;
}

/** No client JS needed — a chip's "remove" link is just the current
 * query string with that one key dropped, server-rendered from `sp`
 * we already have. Matches the page's own "GET form, no client JS"
 * approach for filtering itself. */
function removeFilterHref(sp: Record<string, string | string[] | undefined>, key: string): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || v === undefined) continue;
    next.set(k, Array.isArray(v) ? v[0] : v);
  }
  const qs = next.toString();
  return qs ? `/directory?${qs}` : "/directory";
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const zones = await getAreaZones();

  const filters: DirectoryFilters = {
    role: param(sp, "role") as DirectoryFilters["role"],
    areaId: param(sp, "area") || undefined,
    visitType: param(sp, "visit") as DirectoryFilters["visitType"],
    specialization: param(sp, "specialization") as DirectoryFilters["specialization"],
    language: param(sp, "language") || undefined,
    gender: param(sp, "gender") as DirectoryFilters["gender"],
    ageGroup: param(sp, "ageGroup") as DirectoryFilters["ageGroup"],
    experienceBucket: param(sp, "experience") as ExperienceBucket | undefined,
    teleRehab: param(sp, "teleRehab") === "1",
    // [E4] Off unless the searcher explicitly turns it on.
    verifiedOnly: param(sp, "verifiedOnly") === "1",
  };

  const db = await getDb();
  const [profiles, viewerUserId] = await Promise.all([searchDirectory(db, filters), getVerifiedUserId()]);

  const roleLabel = ROLE_OPTIONS.find((o) => o.value === filters.role)?.label ?? null;
  const localityLabel = zones.flatMap((z) => z.localities).find((l) => l.id === filters.areaId)?.name ?? null;

  const activeFilterChips: ActiveFilterChip[] = [
    filters.role && { key: "role", label: roleLabel ?? filters.role },
    filters.areaId && { key: "area", label: localityLabel ?? "Locality" },
    filters.visitType && { key: "visit", label: VISIT_LABELS[filters.visitType] ?? filters.visitType },
    filters.specialization && {
      key: "specialization",
      label: SPECIALIZATION_LABELS[filters.specialization] ?? filters.specialization,
    },
    filters.language && { key: "language", label: filters.language },
    filters.gender && { key: "gender", label: GENDER_LABELS[filters.gender] ?? filters.gender },
    filters.ageGroup && {
      key: "ageGroup",
      label: AGE_GROUP_OPTIONS.find((o) => o.value === filters.ageGroup)?.label ?? filters.ageGroup,
    },
    filters.experienceBucket && {
      key: "experience",
      label: EXPERIENCE_OPTIONS.find((o) => o.value === filters.experienceBucket)?.label ?? filters.experienceBucket,
    },
    filters.teleRehab && { key: "teleRehab", label: "Tele-rehab available" },
    filters.verifiedOnly && { key: "verifiedOnly", label: "Credentials verified only" },
  ].filter((c): c is ActiveFilterChip => Boolean(c));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Find a verified therapist</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every profile below is a real, individually reviewed professional — see each badge for
        what&apos;s been verified.
      </p>

      <form method="get" className="mt-6 flex flex-col gap-4">
        <div className="flex flex-wrap gap-3">
          <select name="role" defaultValue={filters.role ?? ""} className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Any role</option>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select name="area" defaultValue={filters.areaId ?? ""} className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Any locality</option>
            {zones.map((z) => (
              <optgroup key={z.zone.id} label={z.zone.name}>
                {z.localities.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <select name="visit" defaultValue={filters.visitType ?? ""} className="rounded-md border bg-background px-3 py-2 text-sm">
            <option value="">Home or clinic</option>
            <option value="home">Home visit</option>
            <option value="clinic">Clinic visit</option>
          </select>

          <select
            name="specialization"
            defaultValue={filters.specialization ?? ""}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Any specialization</option>
            {SPECIALIZATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">More filters</summary>
          <div className="mt-3 flex flex-wrap gap-3">
            <input
              name="language"
              placeholder="Language (e.g. Telugu)"
              defaultValue={filters.language ?? ""}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            />
            <select name="gender" defaultValue={filters.gender ?? ""} className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">Any gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non_binary">Non-binary</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
            <select name="ageGroup" defaultValue={filters.ageGroup ?? ""} className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">Any age group served</option>
              {AGE_GROUP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select name="experience" defaultValue={filters.experienceBucket ?? ""} className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">Any experience</option>
              {EXPERIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="teleRehab" value="1" defaultChecked={filters.teleRehab} />
              Tele-rehab available
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="verifiedOnly" value="1" defaultChecked={filters.verifiedOnly} />
              Credentials verified only
            </label>
          </div>
        </details>

        <button type="submit" className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Apply filters
        </button>
      </form>

      {activeFilterChips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {activeFilterChips.map((chip) => (
            <a
              key={chip.key}
              href={removeFilterHref(sp, chip.key)}
              className="flex items-center gap-1.5 rounded-pill border border-graphite bg-transparent px-3 py-1 text-xs font-medium hover:bg-accent"
            >
              {chip.label}
              <span aria-hidden>×</span>
            </a>
          ))}
          <a href="/directory" className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline">
            Clear all
          </a>
        </div>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        {directoryResultsLine(profiles.length, roleLabel, localityLabel)}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<Search className="size-6" aria-hidden />}
            title="No profiles match these filters"
            body="Try widening the role, locality, or specialty filters."
            action={
              <a href="/directory" className="text-sm font-semibold hover:underline">
                Clear filters
              </a>
            }
          />
        )}
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            slug={profile.slug}
            displayName={profile.displayName}
            photoUrl={profile.photoUrl}
            role={profile.role}
            specializations={profile.specializations}
            verificationStage={profile.verificationStage}
            verifiedSinceLabel={
              profile.verifiedSince
                ? new Date(profile.verifiedSince).toLocaleDateString("en-IN", { year: "numeric", month: "long" })
                : undefined
            }
            localityLabel={profile.localityLabel ?? undefined}
            availableForNewPatients={profile.availableForNewPatients}
            availabilityUpdatedAt={profile.availabilityUpdatedAt}
            showAddToCircle={Boolean(viewerUserId) && viewerUserId !== profile.id}
            userId={profile.id}
          />
        ))}
      </div>
    </main>
  );
}
