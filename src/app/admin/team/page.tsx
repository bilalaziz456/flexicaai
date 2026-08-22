import { listCompanyTeam } from "@/core/admin/team";
import { requireAdminCapability } from "@/core/auth/user";
import { adminAccountState, adminSubRoleOf, canAdmin, isOwner } from "@/core/auth/admin-permissions";
import {
  Card,
  CardContent,

  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AddTeamMember } from "./add-team";
import { TeamList } from "./team-list";

/** Team management — gated on the `team:view` capability (owner + super_admin by
 *  default; grantable to others). The Add form needs `team:create`. The OWNER
 *  account is hidden from non-owner viewers — only the owner sees/manages the
 *  owner (Feature 9). */
export default async function TeamPage() {
  const viewer = await requireAdminCapability("team:view");
  const viewerIsOwner = isOwner(viewer);
  const canCreate = canAdmin(viewer, "team:create");

  const rows = await listCompanyTeam(viewerIsOwner);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">
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
              isSelf: u.id === viewer.id,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
