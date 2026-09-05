// Team & Roles panel — §8G5, super_admin only. Page-level gated (not just
// the actions), since a non-super_admin should never even see who holds
// which role.

import { requireAdminAccessOrRedirect } from "@/lib/require-admin-access";
import { listAdmins } from "@/lib/admin-roles";
import { AssignRoleForm } from "./assign-role-form";
import { RevokeRoleButton } from "./revoke-role-button";

export default async function TeamRolesPage() {
  const { db } = await requireAdminAccessOrRedirect({ type: "manage_admin_roles" });
  const admins = await listAdmins(db);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Team &amp; roles</h1>
      <p className="text-sm text-muted-foreground">
        One account, two contexts (§8G5) — promoting a therapist to admin never creates a second
        account, only an admin role alongside their existing profile.
      </p>

      <AssignRoleForm />

      {admins.length === 0 ? (
        <p className="text-sm text-muted-foreground">No admins yet.</p>
      ) : (
        <ul className="space-y-4">
          {admins.map((admin) => (
            <li key={admin.adminUserId} className="rounded-md border p-4">
              <p className="font-medium">{admin.displayName ?? admin.email}</p>
              <p className="text-sm text-muted-foreground">{admin.email}</p>
              {admin.activeRoles.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No active roles.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {admin.activeRoles.map((role) => (
                    <li key={role.roleAssignmentId} className="flex items-center justify-between gap-2">
                      <span className="rounded-full border px-2 py-0.5 text-xs">{role.role}</span>
                      <RevokeRoleButton roleAssignmentId={role.roleAssignmentId} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
