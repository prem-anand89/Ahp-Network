// §9 — the directory search/filter/results block, shared by two routes:
// `/directory` (public, SEO-facing, under (public)/layout.tsx's SiteNav +
// Footer) and `/app/directory` (signed-in, under AppLayout's AppNav +
// AppTabBar). Both call searchDirectory identically; the only thing that
// differs between them is `basePath`, used to build the "Clear
// filters"/chip-removal hrefs so they stay on whichever route the viewer
// is actually on. Before this split, AppNav/AppTabBar both linked
// straight to `/directory`, which meant a signed-in therapist tapping
// "Directory" from inside the app left the app shell entirely (lost the
// bottom tab bar, landed in the marketing footer) even though they were
// still authenticated — see HANDOFF.md.
//
// Filters narrow the result set only; the sort order (verified tier,
// availability recency, completeness, random tiebreak — src/lib/directory.ts)
// is unconditional. A GET form driving searchParams keeps this server-
// rendered with no client JS on the public route, matching (public)'s
// static-first approach elsewhere in the app.

import { Search, Filter } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getDb } from "@/db/db";
import { getCityAreaTree } from "@/lib/area-search";
import {
  getDirectoryCities,
  searchDirectory,
  type DirectoryFilters,
  type ExperienceBucket,
} from "@/lib/directory";
import { ProfileCard } from "@/components/cards/profile-card";
import { EmptyState } from "@/components/ui-ahp/empty-state";
import { SPECIALIZATION_LABELS } from "@/lib/referral-labels";
import { directoryResultsLine } from "@/lib/copy";
import { getVerifiedUserId } from "@/lib/supabase/server";
import { OmniSearchInput } from "./omni-search-input";

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
function removeFilterHref(
  basePath: string,
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === key || v === undefined) continue;
    next.set(k, Array.isArray(v) ? v[0] : v);
  }
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export async function DirectorySearch({
  searchParams,
  basePath,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  const sp = searchParams;

  const filters: DirectoryFilters = {
    role: param(sp, "role") as DirectoryFilters["role"],
    cityAreaId: param(sp, "city") || undefined,
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
    q: param(sp, "q") || undefined,
  };

  const db = await getDb();
  // Round 3 step F — cities is the bounded "has ≥1 listed therapist" list
  // (plan §6), always fetched. cityTree only once a city is actually
  // picked — the locality select is scoped to it, not the whole national
  // registry. A stale/invalid city id in the URL (city later unlisted,
  // or hand-edited) falls back to no locality options rather than a 500.
  const [profiles, viewerUserId, cities, cityTree] = await Promise.all([
    searchDirectory(db, filters),
    getVerifiedUserId(),
    getDirectoryCities(db),
    filters.cityAreaId ? getCityAreaTree(db, filters.cityAreaId).catch(() => null) : Promise.resolve(null),
  ]);

  const roleLabel = ROLE_OPTIONS.find((o) => o.value === filters.role)?.label ?? null;
  const cityLabel = cities.find((c) => c.id === filters.cityAreaId)?.name ?? null;
  const localityOptions = cityTree ? [...cityTree.zones.flatMap((z) => z.localities), ...cityTree.unzoned] : [];
  const localityLabel = localityOptions.find((l) => l.id === filters.areaId)?.name ?? null;
  // The results line and "Clear filters" empty state read "in {place}" —
  // a picked locality/zone is the more specific place; falling back to
  // the city keeps that line accurate when only the city filter is set.
  const whereLabel = localityLabel ?? cityLabel;

  const activeFilterChips: ActiveFilterChip[] = [
    filters.q && { key: "q", label: `"${filters.q}"` },
    filters.role && { key: "role", label: roleLabel ?? filters.role },
    filters.cityAreaId && { key: "city", label: cityLabel ?? "City" },
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

      <OmniSearchInput
        basePath={basePath}
        currentSearch={removeFilterHref("", sp, "q").replace(/^\?/, "")}
        initialQuery={filters.q ?? ""}
      />

      <Sheet>
        <SheetTrigger className="mt-4 flex items-center gap-2 self-start rounded-pill border-[1.5px] border-graphite bg-background px-4 py-2 text-sm font-medium hover:bg-accent">
          <Filter className="size-4" />
          Filters ({activeFilterChips.length})
        </SheetTrigger>
        <SheetContent className="w-[90vw] sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <form method="get" className="mt-6 flex flex-col gap-4">
            <select name="role" defaultValue={filters.role ?? ""} className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm">
              <option value="">Any role</option>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {/* Round 3 step F — a bounded "cities with a listed
                therapist" select (plan §6), never the national registry.
                No client JS on this page (see file header), so the
                locality select below is a second submit: pick a city,
                Apply, then the locality select is populated for it. */}
            <select name="city" defaultValue={filters.cityAreaId ?? ""} className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm">
              <option value="">Any city</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              name="area"
              defaultValue={filters.areaId ?? ""}
              disabled={!cityTree}
              className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">{cityTree ? "Any locality" : "Choose a city first"}</option>
              {cityTree?.zones.map((z) => (
                <optgroup key={z.id} label={z.name}>
                  {z.localities.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              {cityTree && cityTree.unzoned.length > 0 && (
                <optgroup label={cityTree.cityName}>
                  {cityTree.unzoned.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <select name="visit" defaultValue={filters.visitType ?? ""} className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm">
              <option value="">Home or clinic</option>
              <option value="home">Home visit</option>
              <option value="clinic">Clinic visit</option>
            </select>

            <select
              name="specialization"
              defaultValue={filters.specialization ?? ""}
              className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm"
            >
              <option value="">Any specialization</option>
              {SPECIALIZATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <input
              name="language"
              placeholder="Language (e.g. Telugu)"
              defaultValue={filters.language ?? ""}
              className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm"
            />

            <select name="gender" defaultValue={filters.gender ?? ""} className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm">
              <option value="">Any gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non_binary">Non-binary</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>

            <select name="ageGroup" defaultValue={filters.ageGroup ?? ""} className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm">
              <option value="">Any age group served</option>
              {AGE_GROUP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select name="experience" defaultValue={filters.experienceBucket ?? ""} className="rounded-input border-[1.5px] border-graphite bg-background px-3 py-2 text-sm">
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

            <button type="submit" className="mt-2 self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Apply filters
            </button>
          </form>
        </SheetContent>
      </Sheet>

      {activeFilterChips.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {activeFilterChips.map((chip) => (
            <a
              key={chip.key}
              href={removeFilterHref(basePath, sp, chip.key)}
              className="flex items-center gap-1.5 rounded-pill border border-graphite bg-transparent px-3 py-1 text-xs font-medium hover:bg-accent"
            >
              {chip.label}
              <span aria-hidden>×</span>
            </a>
          ))}
          <a href={basePath} className="text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline">
            Clear all
          </a>
        </div>
      )}

      <p className="mt-4 text-sm text-muted-foreground">
        {directoryResultsLine(profiles.length, roleLabel, whereLabel)}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.length === 0 && (
          <EmptyState
            className="col-span-full"
            icon={<Search className="size-6" aria-hidden />}
            title="No profiles match these filters"
            body="Try widening the role, locality, or specialty filters."
            action={
              <a href={basePath} className="text-sm font-semibold hover:underline">
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
            capacityState={profile.capacityState}
            availabilityUpdatedAt={profile.availabilityUpdatedAt}
            showAddToCircle={Boolean(viewerUserId) && viewerUserId !== profile.id}
            userId={profile.id}
          />
        ))}
      </div>
    </main>
  );
}
