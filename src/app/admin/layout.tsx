// The /admin/* URL segment's outer gate: authenticated + has an active
// admin role (src/lib/authz.ts's enter_admin_mode). This wraps /admin/verify
// too — you must already be an admin to attempt the re-authentication step,
// but the freshness check itself (and its redirect target) lives one level
// deeper in (protected)/layout.tsx specifically so /admin/verify is never
// wrapped by the check that would redirect back to itself.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";
import { can } from "@/lib/authz";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    redirect("/login?next=/admin");
  }

  const db = await getDb();
  const adminRoles = await getActiveAdminRoles(db, authUser.id);

  const authzResult = can(
    {
      id: authUser.id,
      accountType: "therapist",
      verificationStage: "unverified",
      adminRoles,
      contactDisclosureHoldUntil: null,
    },
    { type: "enter_admin_mode" },
  );

  if (!authzResult.allowed) {
    redirect("/app/dashboard");
  }

  return <>{children}</>;
}
