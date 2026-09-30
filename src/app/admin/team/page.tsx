import { listCompanyTeam } from "@/core/admin/team";
import { getCompanySupportContact } from "@/core/admin/company-settings";
import { requireAdminCapability } from "@/core/auth/user";
import { adminAccountState, adminSubRoleOf, canAdmin, isOwner } from "@/core/auth/admin-permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddTeamMember } from "./add-team";
import { TeamList } from "./team-list";
import { SupportContactForm } from "./support-contact-form";

/** Team management — gated on the `team:view` capability (owner + super_admin by
 *  default; grantable to others). The Add form needs `team:create`. The OWNER
 *  account is hidden from non-owner viewers — only the owner sees/manages the
 *  owner (Feature 9). */
export default async function TeamPage() {
  const viewer = await requireAdminCapability("team:view");
  const viewerIsOwner = isOwner(viewer);
  const canCreate = canAdmin(viewer, "team:create");

  const canEdit = canAdmin(viewer, "team:edit");
  const [rows, support] = await Promise.all([
    listCompanyTeam(viewerIsOwner),
    getCompanySupportContact(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Team</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Company team members and their roles. <strong>Super admin</strong>: full access.{" "}
          <strong>Support</strong>: clinics, impersonate, announcements, metrics.{" "}
          <strong>Sales</strong>: add &amp; manage clinics and metrics.{" "}
          <strong>Billing</strong>: payments + metrics.
        </p>
      </div>

      {canCreate ? <AddTeamMember /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Team members ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamList
            members={rows.map((u) => ({
              id: u.id,
              username: u.username,
              fullName: u.fullName,
              state: adminAccountState(u),
              subRole: adminSubRoleOf(u),
              phone: u.phone,
              isSelf: u.id === viewer.id,
            }))}
          />
        </CardContent>
      </Card>

      {/* The DEFAULT account contact, sitting under the roster because it answers the
          same question for the clinics that are not on it: who does this clinic call?
          An unassigned clinic is the common case early on, so without this the answer
          is nobody. */}
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Company contact</CardTitle>
            <CardDescription>
              Shown to a clinic that has no account manager — or whose manager has no
              number on file.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SupportContactForm phone={support.phone} email={support.email} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
