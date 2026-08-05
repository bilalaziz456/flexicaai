import { and, eq, isNotNull } from "drizzle-orm";
import { requireAdminCapability } from "@/core/auth/user";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
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

/** Team management — gated on the `team:view` capability (owner + super_admin by
 *  default; grantable to others). The Add form needs `team:create`. The OWNER
 *  account is hidden from non-owner viewers — only the owner sees/manages the
 *  owner (Feature 9). */
export default async function TeamPage() {
  const viewer = await requireAdminCapability("team:view");
  const viewerIsOwner = isOwner(viewer);
  const canCreate = canAdmin(viewer, "team:create");

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      isActive: users.isActive,
      deactivatedAt: users.deactivatedAt,
      permissions: users.permissions,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.role, "super_admin"),
        notDeleted(users.deletedAt),
        // Non-owners never see the owner account (NULL permissions = owner).
        viewerIsOwner ? undefined : isNotNull(users.permissions),
      ),
    )
    .orderBy(users.username);

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
