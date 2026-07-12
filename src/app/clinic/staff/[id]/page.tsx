import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, gte } from "drizzle-orm";
import { Ban, CalendarClock, CalendarOff, RotateCcw } from "lucide-react";
import { requireClinicAdmin } from "@/core/auth/user";
import { setStaffActive } from "@/app/clinic/actions";
import { DoctorLeaves } from "@/app/reception/doctor-leaves";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { doctorLeaves, users } from "@/core/db/schema";
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
import { EditScheduleForm } from "./edit-schedule-form";
import {
  DeleteStaffButton,
  EditProfileForm,
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
  const { clinicId } = await requireClinicAdmin();
  const { id } = await params;

  const [member] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      role: users.role,
      isActive: users.isActive,
      availability: users.availability,
      flexibleHours: users.flexibleHours,
      dailyLimit: users.dailyAppointmentLimit,
      fee: users.consultationFee,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, eq(users.id, id)))
    .limit(1);

  // Clinic-scoped and only doctors/receptionists are manageable here.
  if (!member || (member.role !== "doctor" && member.role !== "receptionist")) {
    notFound();
  }

  const label = member.fullName ?? member.username;

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
              and(
                eq(doctorLeaves.doctorId, member.id),
                gte(doctorLeaves.endDate, today),
              ),
            ),
          )
          .orderBy(asc(doctorLeaves.startDate))
      : [];

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

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Edit the name and login username.</CardDescription>
        </CardHeader>
        <CardContent>
          <EditProfileForm
            userId={member.id}
            fullName={member.fullName}
            username={member.username}
          />
        </CardContent>
      </Card>

      {member.role === "doctor" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-5 text-muted-foreground" aria-hidden="true" />
              Schedule &amp; fees
            </CardTitle>
            <CardDescription>
              Working days &amp; hours, daily appointment cap, and consultation
              fee. Bookings outside these are blocked.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditScheduleForm
              userId={member.id}
              availability={member.availability}
              dailyLimit={member.dailyLimit}
              fee={member.fee}
              flexibleHours={member.flexibleHours}
            />
          </CardContent>
        </Card>
      ) : null}

      {member.role === "doctor" ? (
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

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            Set a temporary password; they must change it at next login.
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
              : "This account is suspended — reactivate to restore access."}
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
            Permanently delete this staff member. Visit history is kept; their
            sessions end immediately. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteStaffButton userId={member.id} label={label} />
        </CardContent>
      </Card>
    </div>
  );
}
