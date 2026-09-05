// The /app/* URL segment — therapist-facing work, per §8G5's "/app/* vs
// /admin/*, never mixed in one navigation." A real path prefix, not just
// an internal route group, since that rule is about the URL surface a
// therapist and an admin each see, not an implementation detail.
//
// Requires an authenticated session — this is a genuine dynamic check
// (cookies() via Supabase's server client), which is exactly why this
// layout must stay outside (public)'s subtree: see (public)/layout.tsx
// and scripts/check-public-routes-static.mjs, which fails the build if a
// check like this one ever leaks into the public directory's layout chain.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <AppNav />
      {children}
    </div>
  );
}
