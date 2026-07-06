import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { clinics, users } from "@/core/db/schema";
import { SPECIALTY_CATALOG } from "@/config/modules";
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
import { ModulesForm } from "./modules-form";
import { RenameClinicForm } from "./rename-clinic-form";
import { StaffActions } from "./staff-actions";
import { DeleteClinic } from "./delete-clinic";

/** Super Admin: manage one clinic — toggle specialties, view its staff. */
export default async function ClinicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [clinic] = await db
    .select()
    .from(clinics)
    .where(eq(clinics.id, id))
    .limit(1);

  if (!clinic) notFound();

  // Tenant-scoped: this clinic's staff only (byClinic = the isolation boundary).
  const staff = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      fullName: users.fullName,
      isActive: users.isActive,
    })
    .from(users)
    .where(byClinic(users.clinicId, id));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to clinics
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{clinic.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clinic name</CardTitle>
          <CardDescription>Rename this clinic.</CardDescription>
        </CardHeader>
        <CardContent>
          <RenameClinicForm clinicId={clinic.id} name={clinic.name} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specialties</CardTitle>
          <CardDescription>
            Toggle which modules this clinic can use. Only these appear in the
            clinic&apos;s workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ModulesForm
            clinicId={clinic.id}
            catalog={SPECIALTY_CATALOG}
            enabled={clinic.modulesEnabled}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>
            {staff.length} account{staff.length === 1 ? "" : "s"}. The clinic
            admin adds doctors and receptionists from their own panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
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
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{u.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {u.isActive ? (
                      "Active"
                    ) : (
                      <span className="text-muted-foreground">Disabled</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StaffActions userId={u.id} isActive={u.isActive} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this clinic and all its data — staff, patients,
            appointments, visits and recalls. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteClinic clinicId={clinic.id} clinicName={clinic.name} />
        </CardContent>
      </Card>
    </div>
  );
}
