// Admin home — §8G6's nav table: nobody sees a section they don't hold a
// role for. Analytics is a link-out visible to any admin role (read-only,
// no write-action scoping needed); during the pilot that's the saved
// queries against the `analytics` views (§E3), not a hosted tool yet.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/db/db";
import { getActiveAdminRoles } from "@/lib/get-admin-roles";

interface NavSection {
  href: string;
  label: string;
  roles: string[] | "any";
}

const SECTIONS: NavSection[] = [
  { href: "/admin/verification", label: "Verification queue", roles: ["verification_admin", "super_admin"] },
  { href: "/admin/practice-claims", label: "Practice claims", roles: ["verification_admin", "super_admin"] },
  { href: "/admin/communities", label: "Communities", roles: ["verification_admin", "super_admin"] },
  {
    href: "/admin/curation/institutions",
    label: "Curation — institutions",
    roles: ["verification_admin", "super_admin"],
  },
  { href: "/admin/curation/councils", label: "Curation — councils", roles: ["verification_admin", "super_admin"] },
  { href: "/admin/curation/courses", label: "Curation — courses", roles: ["verification_admin", "super_admin"] },
  { href: "/admin/referral-ops", label: "Referral ops", roles: ["referral_ops_admin", "super_admin"] },
  { href: "/admin/grievance", label: "Grievance", roles: ["grievance_officer", "super_admin"] },
  { href: "/admin/feedback", label: "Feedback", roles: ["support_admin", "super_admin"] },
  { href: "/admin/team-roles", label: "Team & roles", roles: ["super_admin"] },
  { href: "/admin/deletion-requests", label: "Data export & deletion requests", roles: ["super_admin"] },
];

export default async function AdminHomePage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/admin/verify");

  const db = await getDb();
  const adminRoles = await getActiveAdminRoles(db, authUser.id);

  const visibleSections = SECTIONS.filter(
    (section) => section.roles === "any" || section.roles.some((r) => adminRoles.includes(r)),
  );

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Admin</h1>
      {visibleSections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No admin sections available for your role.</p>
      ) : (
        <ul className="space-y-2">
          {visibleSections.map((section) => (
            <li key={section.href}>
              <Link href={section.href} className="block rounded-md border p-3 text-sm hover:bg-accent">
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
