import { and, eq } from "drizzle-orm";
import { requireAdminOwner } from "@/core/auth/user";
import { db } from "@/core/db";
import { notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { adminSubRoleOf } from "@/core/auth/admin-permissions";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { CreateSuperAdminForm } from "./create-form";
import { TeamRowActions } from "./team-actions";

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
          Company super-admins and their sub-roles. Owner = full access; Support =
          clinics + impersonate + announcements + metrics; Billing = payments + metrics.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add super-admin</CardTitle>
          <CardDescription>They set their own password on first login.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateSuperAdminForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Super-admins ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {rows.map((u) => {
              const role = adminSubRoleOf(u);
              const isSelf = u.id === owner.id;
              return (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{u.fullName ?? u.username}</span>
                      <span className="text-sm text-muted-foreground">@{u.username}</span>
                      <Badge variant="secondary" className="capitalize">{role}</Badge>
                      {isSelf ? <Badge variant="outline">you</Badge> : null}
                      {!u.isActive ? <span className="text-xs text-muted-foreground">suspended</span> : null}
                    </div>
                  </div>
                  <TeamRowActions
                    userId={u.id}
                    currentRole={role === "custom" ? "support" : role}
                    isActive={u.isActive}
                    isSelf={isSelf}
                  />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
