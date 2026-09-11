// The /app/* URL segment — therapist-facing work, per §8G5's "/app/* vs
// /admin/*, never mixed in one navigation." A real path prefix, not just
// an internal route group, since that rule is about the URL surface a
// therapist and an admin each see, not an implementation detail.
//
// Session presence is enforced in src/proxy.ts (not here) so client-side
// nav between /app/* pages never hits layout redirect(). This layout stays
// outside (public)'s subtree — see scripts/check-public-routes-static.mjs.
//
import { AppNav } from "@/components/app-nav";

// force-dynamic deliberately lives on each /app/* page.tsx, never here.
// It used to live on this layout instead — removed after a real production
// crash traced to exactly that combination: Next.js's own documented
// behavior is that a dynamic layout forces its whole subtree to render as
// one SSR unit, which collides with the per-route Suspense boundaries each
// page's loading.tsx creates — surfacing as React error #419 ("This
// Suspense boundary received an update before it finished hydrating") on
// navigation between /app/* routes, reliably, not just under fast
// clicking. Every page under /app/* must declare `export const dynamic =
// "force-dynamic"` itself — src/app/app/dynamic-pages.test.ts fails the
// build if one doesn't, which is what originally motivated hoisting this
// to the layout: a page with no dynamic API call of its own (e.g. a page
// that's just a client form, like feedback/page.tsx) would otherwise
// silently qualify for build-time static generation — one frozen HTML
// response served to every signed-in therapist. The test closes that gap
// without needing the layout-level setting that caused this crash.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Session gate lives in src/proxy.ts — see the comment there on why this
  // layout must not call redirect() itself.

  return (
    <div className="min-h-screen">
      <AppNav />
      <div id="main">{children}</div>
    </div>
  );
}
