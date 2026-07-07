import { desc, inArray } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { AddStaffForm } from "./add-staff-form";
import { StaffActions } from "./staff-actions";

/** Clinic Admin: manage this clinic's doctors and receptionists. */
export default async function ClinicStaffPage() {
  const { clinicId } = await requireClinicAdmin();

  // Clinic-scoped (byClinic) + role filter; both use the clinic_id index.
  const staff = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(
      byClinic(users.clinicId, clinicId, inArray(users.role, [
        "doctor",
        "receptionist",
      ])),
    )
    .orderBy(desc(users.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Staff</h1>
        <p className="text-sm text-muted-foreground">
          Add doctors and receptionists. They log in with the username and
          temporary password you set.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add staff</CardTitle>
          <CardDescription>Create a doctor or receptionist account.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddStaffForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>
            {staff.length} staff member{staff.length === 1 ? "" : "s"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No staff yet. Add your first doctor or receptionist above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.fullName ?? "—"}
                    </TableCell>
                    <TableCell>{u.username}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.isActive ? (
                        "Active"
                      ) : (
                        <span className="text-muted-foreground">Suspended</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StaffActions userId={u.id} isActive={u.isActive} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
