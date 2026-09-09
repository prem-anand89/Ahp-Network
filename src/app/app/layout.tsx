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

// force-dynamic here, not per-page: this layout itself calls no dynamic
// API (see the comment below on why it must not), so a page under /app/*
// that also happens not to call one (e.g. a page that's just a client
// form, like feedback/page.tsx) silently qualified for build-time static
// generation — one frozen HTML response served to every signed-in
// therapist, discovered via `next build`'s route listing (○ instead of ƒ)
// rather than any error. Every /app/* page is inherently per-session; none
// of them should ever be a build-time artifact.
export const dynamic = "force-dynamic";

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
