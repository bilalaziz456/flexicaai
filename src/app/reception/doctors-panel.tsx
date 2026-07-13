import { and, asc, desc, gte, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
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
 * Shared by the reception panel and the unified clinic workspace. The caller
 * gates on `leave:view`; the forms enforce leave create/edit/delete.
 */
export async function DoctorsPanel({ clinicId }: { clinicId: string }) {
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
      .where(byClinic(users.clinicId, clinicId, inArray(users.role, ["doctor"])))
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
      .where(byClinic(doctorLeaves.clinicId, clinicId, gte(doctorLeaves.endDate, today)))
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
        <h1 className="text-xl font-semibold">Doctors</h1>
        <p className="text-sm text-muted-foreground">
          Set daily appointment limits and leave / vacation days.
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
                <div className="space-y-1">
                  <div className="text-sm font-medium">Daily appointment limit</div>
                  <DailyLimitForm doctorId={d.id} limit={d.dailyLimit} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">Leave / vacation</div>
                  <DoctorLeaves doctorId={d.id} leaves={leavesByDoctor.get(d.id) ?? []} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
