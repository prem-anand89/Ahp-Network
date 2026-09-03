// The authenticated app route group's layout. Real session/auth checks land
// here in Phase 1 (Supabase Auth). Calls headers() now — a genuine dynamic
// API — specifically to prove this group's dynamic rendering stays isolated
// from (public), which must remain static. See (public)/layout.tsx and
// scripts/check-public-routes-static.mjs.

import { headers } from "next/headers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await headers();
  return <>{children}</>;
}
