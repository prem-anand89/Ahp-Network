// Round 2 step 3 — practice 2-way consent, the owner/manager side. A
// plain server component with native forms (same convention as the admin
// verification queue page: no client state needed to submit FormData
// through a "use server" closure).

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PRACTICE_CONSENT_COPY } from "@/lib/copy";
import { invitePracticeMember, removeTeamMember, respondToJoinRequest } from "../../actions";

const ACCESS_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

interface Member {
  userId: string;
  displayName: string | null;
  accessRole: string;
  assertedBy: string;
}

interface JoinRequest {
  userId: string;
  displayName: string | null;
}

export function PracticeTeamSection({
  practiceId,
  viewerUserId,
  members,
  requests,
}: {
  practiceId: string;
  viewerUserId: string;
  members: Member[];
  requests: JoinRequest[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Team</h2>

      {requests.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{PRACTICE_CONSENT_COPY.requested.title}</h3>
          {requests.map((req) => (
            <div key={req.userId} className="flex items-center justify-between gap-4 rounded-md border p-4">
              <p className="text-sm">{PRACTICE_CONSENT_COPY.requested.body(req.displayName ?? "A therapist")}</p>
              <div className="flex shrink-0 gap-2">
                <form action={respondToJoinRequest.bind(null, practiceId, req.userId, true)}>
                  <Button type="submit" size="sm">{PRACTICE_CONSENT_COPY.requested.accept}</Button>
                </form>
                <form action={respondToJoinRequest.bind(null, practiceId, req.userId, false)}>
                  <Button type="submit" variant="outline" size="sm">{PRACTICE_CONSENT_COPY.requested.decline}</Button>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Current team</h3>
        {members.map((member) => (
          <div key={member.userId} className="flex items-center justify-between gap-4 rounded-md border p-4">
            <div>
              <p className="text-sm font-medium">{member.displayName ?? "Unnamed"}</p>
              <p className="text-xs text-muted-foreground">{ACCESS_ROLE_LABELS[member.accessRole] ?? member.accessRole}</p>
            </div>
            {member.userId !== viewerUserId && member.accessRole !== "owner" && member.assertedBy === "practice" && (
              <form action={removeTeamMember.bind(null, practiceId, member.userId)}>
                <Button type="submit" variant="outline" size="sm" className="border-destructive text-destructive hover:bg-destructive/10">
                  Remove
                </Button>
              </form>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Invite someone</h3>
        <form
          action={async (formData: FormData) => {
            "use server";
            const email = String(formData.get("email") ?? "");
            const accessRole = String(formData.get("accessRole") ?? "staff") as "manager" | "staff";
            await invitePracticeMember(practiceId, email, accessRole);
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-xs">Email</Label>
            <Input id="email" name="email" type="email" required className="w-auto" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="accessRole" className="text-xs">Role</Label>
            <select
              id="accessRole"
              name="accessRole"
              defaultValue="staff"
              className="h-9 w-fit rounded-md border bg-background px-2 text-sm"
            >
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <Button type="submit" size="sm">Send invite</Button>
        </form>
      </div>
    </div>
  );
}
