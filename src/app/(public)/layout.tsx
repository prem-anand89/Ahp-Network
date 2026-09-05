// The public route group's layout. Deliberately calls no dynamic API
// (cookies(), headers(), unauthenticated session lookups) — a single such
// call anywhere in this subtree's layout chain silently opts the whole
// public, SEO-facing directory into dynamic rendering with no build error.
// See BUILD_SEQUENCE.md Phase 0 (§B2) and the CI static-output assertion
// in scripts/check-public-routes-static.mjs, which fails the build if this
// group stops being static/ISR.
//
// Footer legal links (Privacy Policy, Terms of Service, About, Grievance
// Officer), gated on real content existing per CLAUDE.md's footer-legal
// rule. The Footer component itself calls no dynamic API and no getDb() —
// the grievance link's publish flag is fetched client-side instead (see
// src/components/grievance-link.tsx) precisely so this layout stays
// static/ISR.

import { Footer } from "@/components/footer";
import { PublicHeader } from "@/components/public-header";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
