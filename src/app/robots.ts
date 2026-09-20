// Phase 1 step 13 — robots.ts didn't exist. Disallows every non-public
// surface (admin, the authenticated /app tree, auth callback, API routes,
// and the /design kitchen sink) so crawl budget goes to the SEO-facing
// directory and profile pages this product actually wants indexed.

import type { MetadataRoute } from "next";
import { SITE_METADATA } from "@/lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/app", "/auth", "/login", "/api", "/design"],
    },
    sitemap: `${SITE_METADATA.url}/sitemap.xml`,
  };
}
