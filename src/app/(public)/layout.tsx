// The public route group's layout. Deliberately calls no dynamic API
// (cookies(), headers(), unauthenticated session lookups) — a single such
// call anywhere in this subtree's layout chain silently opts the whole
// public, SEO-facing directory into dynamic rendering with no build error.
// See BUILD_SEQUENCE.md Phase 0 (§B2) and the CI static-output assertion
// in scripts/check-public-routes-static.mjs, which fails the build if this
// group stops being static/ISR.
//
// Footer legal links (Privacy Policy, Terms of Service, About, Grievance
// Officer) land here in Phase 1, gated on real content existing per
// CLAUDE.md's footer-legal rule — not built yet, so not stubbed here either.

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
