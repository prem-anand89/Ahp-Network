// The signed-in directory. Found in review, 2026-09-21: AppNav and
// AppTabBar both linked "Directory" straight to /directory, which lives
// under (public)/layout.tsx — a signed-in therapist tapping it left the
// app shell entirely (lost the bottom tab bar, AppNav's avatar menu,
// Communities/Circles nav) and landed in the marketing site's SiteNav +
// Footer, even though the page content itself was already session-aware
// (the "save to circle" button on each card). This route gives the same
// search/filter/results implementation (DirectorySearch,
// src/components/directory/directory-search.tsx) a home inside the app
// shell instead. /directory itself is unchanged — still the public,
// SEO-facing entry point, still under (public)'s static-first layout.
import { DirectorySearch } from "@/components/directory/directory-search";

// Every /app/* page declares this itself — src/app/app/dynamic-pages.test.ts
// fails the build if one doesn't (see that test's header for why).
export const dynamic = "force-dynamic";

export default async function AppDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DirectorySearch searchParams={await searchParams} basePath="/app/directory" />;
}
