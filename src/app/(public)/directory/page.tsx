// §9 — the public directory. See DirectorySearch (src/components/directory/
// directory-search.tsx) for the shared filter/results implementation,
// reused by /app/directory for signed-in visitors (see that route's own
// comment for why it exists as a separate route rather than one shared
// URL). This file owns only what's genuinely public-route-specific: SEO
// metadata and static-render eligibility.

import type { Metadata } from "next";
import { SITE_METADATA } from "@/lib/site-metadata";
import { DirectorySearch } from "@/components/directory/directory-search";

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

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DirectorySearch searchParams={await searchParams} basePath="/directory" />;
}
