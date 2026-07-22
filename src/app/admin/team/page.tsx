import { and, eq } from "drizzle-orm";
import { requireAdminOwner } from "@/core/auth/user";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { adminSubRoleOf } from "@/core/auth/admin-permissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { CreateSuperAdminForm } from "./create-form";
import { TeamList } from "./team-list";

/** Owner-only: manage the company super-admin team + sub-roles (Feature 9). */
export default async function TeamPage() {
  const owner = await requireAdminOwner();

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      isActive: users.isActive,
      permissions: users.permissions,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.role, "super_admin"), notDeleted(users.deletedAt)))
    .orderBy(users.username);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">
          Company team members and their roles. <strong>Owner</strong> — full access;{" "}
          <strong>Support</strong> — clinics, impersonate, announcements, metrics;{" "}
          <strong>Sales</strong> — add &amp; manage clinics + metrics;{" "}
          <strong>Billing</strong> — payments + metrics.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add team member</CardTitle>
          <CardDescription>
            Creates a company account with the chosen role. They set their own password on
            first login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateSuperAdminForm />
        </CardContent>
      </Card>

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
              isActive: u.isActive,
              subRole: adminSubRoleOf(u),
              isSelf: u.id === owner.id,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
