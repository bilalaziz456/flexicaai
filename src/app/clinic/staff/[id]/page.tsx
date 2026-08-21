import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte } from "drizzle-orm";
import { Ban, CalendarClock, CalendarOff, Percent, RotateCcw, ShieldCheck } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { setStaffActive } from "@/app/clinic/actions";
import { DoctorLeaves } from "@/app/clinic/doctors/doctor-leaves";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, doctorLeaves, users } from "@/core/db/schema";
import { getBookingProcedures } from "@/core/appointments/procedures";
import { getDoctorProcedureOverrides } from "@/core/appointments/share-config";
import { CLINIC_STAFF_ROLES } from "@/core/types/auth";
import {
  defaultPermissionsForRole,
  resourcesForClinic,
} from "@/core/auth/permissions";
import { PermissionsGrid } from "./permissions-grid";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ViewLogger } from "@/core/ui/view-logger";
import {
  DeleteStaffButton,
  DoctorSharesForm,
  EditStaffForm,
  ResetPasswordForm,
} from "./staff-admin";

/**
 * Clinic Admin: open a staff member and manage everything in one place — edit
 * profile, (doctors) working hours + daily cap + fee, reset password, suspend/
 * reactivate, and delete. Clinic-scoped + doctor/receptionist only.
 */
export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireWorkspace("staff");
  const { clinicId } = viewer;
  // Viewing is `staff:view`; managing (edit / permissions / password / suspend /
  // delete) is clinic-admin-only — a manager can't escalate their own access.
  const isAdmin = viewer.role === "clinic_admin";
  const { id } = await params;

  const [member] = await db
    .select({
      id: users.id,
      prefix: users.prefix,
      fullName: users.fullName,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
      availability: users.availability,
      flexibleHours: users.flexibleHours,
      dailyLimit: users.dailyAppointmentLimit,
      fee: users.consultationFee,
      permissions: users.permissions,
      consultationSharePct: users.consultationSharePct,
      procedureSharePct: users.procedureSharePct,
      discountNeedsApproval: users.discountNeedsApproval,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        eq(users.id, id),
      ),
    )
    .limit(1);

  // Clinic-scoped and only manageable staff (manager/doctor/receptionist) here.
  if (!member || !(CLINIC_STAFF_ROLES as readonly string[]).includes(member.role)) {
    notFound();
  }

  const label = member.fullName ?? member.username;

  // Permission grid inputs: the resources this clinic can use, and the member's
  // effective permissions (their overrides, or the role defaults when unset).
  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const permResources = resourcesForClinic(clinic?.featuresEnabled);
  const roleDefaults = defaultPermissionsForRole(member.role);
  const effectivePermissions = member.permissions ?? roleDefaults;

  // Current + upcoming leave for doctors.
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const leaves =
    member.role === "doctor"
      ? await db
          .select({
            id: doctorLeaves.id,
            startDate: doctorLeaves.startDate,
            endDate: doctorLeaves.endDate,
            reason: doctorLeaves.reason,
          })
          .from(doctorLeaves)
          .where(
            byClinic(
              doctorLeaves.clinicId,
              clinicId,
              notDeleted(doctorLeaves.deletedAt),
              and(
                eq(doctorLeaves.doctorId, member.id),
                gte(doctorLeaves.endDate, today),
              ),
            ),
          )
          .orderBy(asc(doctorLeaves.startDate))
      : [];

  // Revenue-share config inputs (doctors only): the clinic's priced procedures for
  // per-procedure rate overrides (empty unless the `sales` feature is on) and this
  // doctor's existing overrides.
  const shareProcedures =
    isAdmin && member.role === "doctor"
      ? await getBookingProcedures(clinicId)
      : [];
  const shareOverrides =
    isAdmin && member.role === "doctor"
      ? await getDoctorProcedureOverrides(clinicId, member.id)
      : [];
  const overrideMap: Record<string, number> = {};
  for (const o of shareOverrides) overrideMap[o.procedureId] = o.sharePct;

  return (
    <div className="space-y-6">
      <ViewLogger
        entity="staff"
        entityId={member.id}
        summary={`Viewed staff member ${label}`}
      />
      <div>
        <Link
          href="/clinic/staff"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to staff
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{label}</h1>
          <Badge variant="secondary">{member.role}</Badge>
          {member.isActive ? (
            <Badge variant="outline">Active</Badge>
          ) : (
            <Badge variant="destructive">Suspended</Badge>
          )}
        </div>
      </div>

      {!isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Read-only: ask a clinic admin to make changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Username</dt>
                <dd>@{member.username}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Role</dt>
                <dd className="capitalize">{member.role}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{member.isActive ? "Active" : "Suspended"}</dd>
              </div>
              {member.role === "doctor" && member.fee > 0 ? (
                <div>
                  <dt className="text-muted-foreground">Consultation fee</dt>
                  <dd>Rs {new Intl.NumberFormat("en-PK").format(member.fee)}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {member.role === "doctor" ? (
                <CalendarClock
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              Details
            </CardTitle>
            <CardDescription>
              {member.role === "doctor"
                ? "Name, login, working hours, daily cap and fee. Saved together."
                : "Edit the name and login username."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditStaffForm
              userId={member.id}
              prefix={member.prefix}
              fullName={member.fullName}
              username={member.username}
              role={member.role}
              availability={member.availability}
              dailyLimit={member.dailyLimit}
              fee={member.fee}
              flexibleHours={member.flexibleHours}
            />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && member.role === "doctor" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarOff className="size-5 text-muted-foreground" aria-hidden="true" />
              Leave &amp; vacation
            </CardTitle>
            <CardDescription>
              Mark days off. Appointments in the range are cancelled and no new
              bookings are allowed on those days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DoctorLeaves doctorId={member.id} leaves={leaves} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && member.role === "doctor" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Percent className="size-5 text-muted-foreground" aria-hidden="true" />
              Revenue share
            </CardTitle>
            <CardDescription>
              The doctor&apos;s cut of the consultation fee and of procedures, with
              optional per-procedure rates. Used to split each completed visit
              between the doctor and the clinic.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DoctorSharesForm
              userId={member.id}
              consultationSharePct={member.consultationSharePct}
              procedureSharePct={member.procedureSharePct}
              discountNeedsApproval={member.discountNeedsApproval}
              procedures={shareProcedures}
              initialOverrides={overrideMap}
            />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-muted-foreground" aria-hidden="true" />
            Permissions
          </CardTitle>
          <CardDescription>
            What this {member.role} can do. Tick View / Create / Edit / Delete per
            module. View is required for the others. Starts from the role&apos;s
            defaults until you change it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionsGrid
            userId={member.id}
            resources={permResources}
            initial={effectivePermissions}
            roleDefaults={roleDefaults}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Set a temporary password. They must change it at next login.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm userId={member.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account access</CardTitle>
          <CardDescription>
            {member.isActive
              ? "Suspend to block sign-in and end active sessions immediately."
              : "This account is suspended. Reactivate to restore access."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={setStaffActive.bind(null, member.id, !member.isActive)}>
            <Button type="submit" variant="outline">
              {member.isActive ? (
                <>
                  <Ban className="size-4" aria-hidden="true" /> Suspend
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" aria-hidden="true" /> Reactivate
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this staff member. Visit history is kept, and their
            sessions end immediately. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteStaffButton userId={member.id} label={label} />
        </CardContent>
      </Card>
        </>
      ) : null}
    </div>
  );
}
