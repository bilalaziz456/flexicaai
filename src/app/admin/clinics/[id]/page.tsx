import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, users } from "@/core/db/schema";
import { SPECIALTY_CATALOG } from "@/config/modules";
import { CLINIC_FEATURES } from "@/core/lib/features";
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
import { ClinicSettingsForm } from "./clinic-settings-form";
import { ClinicLifecycle } from "./clinic-lifecycle";
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
      username: users.username,
      role: users.role,
      fullName: users.fullName,
      isActive: users.isActive,
    })
    .from(users)
    .where(byClinic(users.clinicId, id, notDeleted(users.deletedAt)));

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
          <CardTitle>Subscription & access</CardTitle>
          <CardDescription>
            Control whether this clinic can use the app. Suspending, cancelling or an
            expired trial locks out all its staff immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicLifecycle
            clinicId={clinic.id}
            status={clinic.status}
            trialEndsAt={clinic.trialEndsAt ? clinic.trialEndsAt.toISOString() : null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>
            Name, specialties, optional features and activity-log access — all
            saved together.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClinicSettingsForm
            clinicId={clinic.id}
            name={clinic.name}
            catalog={SPECIALTY_CATALOG}
            features={CLINIC_FEATURES}
            modulesEnabled={clinic.modulesEnabled}
            featuresEnabled={clinic.featuresEnabled}
            logAccess={clinic.logAccess}
            trashRetentionDays={clinic.trashRetentionDays}
            whatsappPhoneNumberId={clinic.whatsappPhoneNumberId}
            whatsappDisplayNumber={clinic.whatsappDisplayNumber}
            whatsappSenderName={clinic.whatsappSenderName}
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
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No staff yet. The clinic admin adds doctors and receptionists.
            </p>
          ) : (
            <>
              {/* Desktop: full table. */}
              <div className="hidden md:block">
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
                            <span className="text-muted-foreground">Disabled</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StaffActions
                            userId={u.id}
                            username={u.username}
                            fullName={u.fullName}
                            isActive={u.isActive}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: stacked cards — no horizontal scroll; icon-only actions. */}
              <ul className="space-y-3 md:hidden">
                {staff.map((u) => (
                  <li key={u.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{u.fullName ?? "—"}</span>
                      <Badge variant="secondary">{u.role}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      @{u.username} · {u.isActive ? "Active" : "Disabled"}
                    </div>
                    <StaffActions
                      userId={u.id}
                      username={u.username}
                      fullName={u.fullName}
                      isActive={u.isActive}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
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
