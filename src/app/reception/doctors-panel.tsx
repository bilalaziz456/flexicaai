import { asc, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { doctorLeaves, users } from "@/core/db/schema";
import { describeAvailability } from "@/core/lib/availability";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { DailyLimitForm } from "./daily-limit-form";
import { DoctorLeaves, type LeaveItem } from "./doctor-leaves";

/**
 * Doctors panel — per-doctor daily appointment cap + leave / vacation days.
 * Shared by the unified clinic workspace. The caller gates on `leave:view`; the
 * forms enforce leave create/edit/delete.
 *
 * `selfDoctorId` (set when the viewer is a doctor) restricts the panel to that
 * one doctor and drops the daily-cap control — a doctor manages ONLY their own
 * leave. Admin / manager / receptionist see every doctor + the cap.
 */
export async function DoctorsPanel({
  clinicId,
  selfDoctorId = null,
  canCreate = true,
  canEdit = true,
  canDelete = true,
}: {
  clinicId: string;
  selfDoctorId?: string | null;
  /** Show the add-leave form (leave:create). */
  canCreate?: boolean;
  /** Show the edit control on each leave entry (leave:edit). */
  canEdit?: boolean;
  /** Show the remove-leave button (leave:delete). */
  canDelete?: boolean;
}) {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;

  const [docs, leaveRows] = await Promise.all([
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        availability: users.availability,
        dailyLimit: users.dailyAppointmentLimit,
      })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          notDeleted(users.deletedAt),
          selfDoctorId
            ? eq(users.id, selfDoctorId)
            : inArray(users.role, ["doctor"]),
        ),
      )
      .orderBy(desc(users.createdAt)),
    db
      .select({
        id: doctorLeaves.id,
        doctorId: doctorLeaves.doctorId,
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
          gte(doctorLeaves.endDate, today),
        ),
      )
      .orderBy(asc(doctorLeaves.startDate)),
  ]);

  const leavesByDoctor = new Map<string, LeaveItem[]>();
  for (const l of leaveRows) {
    const list = leavesByDoctor.get(l.doctorId) ?? [];
    list.push({ id: l.id, startDate: l.startDate, endDate: l.endDate, reason: l.reason });
    leavesByDoctor.set(l.doctorId, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {selfDoctorId ? "My leave" : "Doctors"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {selfDoctorId
            ? "Add your leave / vacation days. Appointments in the range are cancelled and no new bookings are allowed."
            : "Set daily appointment limits and leave / vacation days."}
        </p>
      </div>

      {docs.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No doctors yet. The clinic admin adds them.
        </div>
      ) : (
        <div className="space-y-4">
          {docs.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <CardTitle>{d.fullName ?? d.username}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {describeAvailability(d.availability)}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {!selfDoctorId ? (
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Daily appointment limit</div>
                    <DailyLimitForm doctorId={d.id} limit={d.dailyLimit} />
                  </div>
                ) : null}
                <div className="space-y-1">
                  <div className="text-sm font-medium">Leave / vacation</div>
                  <DoctorLeaves
                    doctorId={d.id}
                    leaves={leavesByDoctor.get(d.id) ?? []}
                    canCreate={canCreate}
                    canEdit={canEdit}
                    canDelete={canDelete}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
