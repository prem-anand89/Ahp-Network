// The /app/* URL segment — therapist-facing work, per §8G5's "/app/* vs
// /admin/*, never mixed in one navigation." A real path prefix, not just
// an internal route group, since that rule is about the URL surface a
// therapist and an admin each see, not an implementation detail.
//
// Session presence is enforced in src/proxy.ts (not here) so client-side
// nav between /app/* pages never hits layout redirect(). This layout stays
// outside (public)'s subtree — see scripts/check-public-routes-static.mjs.

import { AppNav } from "@/components/app-nav";

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
