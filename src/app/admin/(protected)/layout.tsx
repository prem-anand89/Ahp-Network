// The freshness gate — §8G5's "re-authentication to enter admin mode,
// with a 2-hour idle timeout." Deliberately a route group nested inside
// admin/, not the outer admin/layout.tsx: /admin/verify sits as a sibling
// OUTSIDE this group so it's never subject to the redirect this layout
// enforces (which would otherwise redirect /admin/verify to itself).
//
// "Unmissable visual distinction" (§8G5) is this persistent banner, not a
// colour tweak buried in a shared header — an admin-mode page must never
// look interchangeable with a therapist-mode one at a glance.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  ADMIN_MODE_COOKIE_NAME,
  isAdminSessionActive,
  parseAdminModeCookie,
} from "@/lib/admin-session";

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const lastActivity = parseAdminModeCookie(cookieStore.get(ADMIN_MODE_COOKIE_NAME)?.value);

  if (!isAdminSessionActive(lastActivity)) {
    redirect("/admin/verify");
  }

  // The sliding idle window itself is refreshed in middleware.ts, not
  // here — cookies().set() is only valid in a Server Action or Route
  // Handler, never in a Server Component's render body.

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground">
        ADMIN MODE — actions here are audited
      </div>
      {children}
    </div>
  );
}
