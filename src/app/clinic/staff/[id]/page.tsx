import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Ban, CalendarClock, RotateCcw } from "lucide-react";
import { requireClinicAdmin } from "@/core/auth/user";
import { setStaffActive } from "@/app/clinic/actions";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
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

  return (
    <div className="space-y-6">
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
            />
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
