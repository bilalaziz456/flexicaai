import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { AppointmentActions } from "./appointment-actions";
import { DeleteAppointmentButton } from "./edit-appointment-form";
import { NewAppointmentForm } from "./new-appointment-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  confirmed: "default",
  completed: "default",
  scheduled: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Shared appointment detail (used by /clinic/appointments/[id] and
 * /reception/appointments/[id]). Clinic-scoped fetch; edit + status + delete.
 */
export async function AppointmentDetail({
  clinicId,
  appointmentId,
  backHref,
}: {
  clinicId: string;
  appointmentId: string;
  backHref: string;
}) {
  const [appt] = await db
    .select({
      id: appointments.id,
      doctorId: appointments.doctorId,
      scheduledAt: appointments.scheduledAt,
      durationMinutes: appointments.durationMinutes,
      status: appointments.status,
      reason: appointments.reason,
      source: appointments.source,
      patientId: patients.id,
      patientName: patients.fullName,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  if (!appt) notFound();

  const doctors = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      flexibleHours: users.flexibleHours,
    })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, inArray(users.role, ["doctor"])))
    .orderBy(desc(users.createdAt));

  const d = appt.scheduledAt;
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const whenLabel = d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to appointments
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{appt.patientName}</h1>
          <Badge variant={STATUS_VARIANT[appt.status] ?? "secondary"}>
            {appt.status.replace("_", " ")}
          </Badge>
          {appt.source === "whatsapp" ? (
            <Badge variant="outline">via WhatsApp</Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{whenLabel}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Confirm, complete, cancel or mark no-show.</CardDescription>
        </CardHeader>
        <CardContent>
          <AppointmentActions id={appt.id} status={appt.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edit</CardTitle>
          <CardDescription>
            Change the doctor, date &amp; time, duration or reason.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm
            doctors={doctors}
            initialPatients={[]}
            appointmentId={appt.id}
            fixedPatient={{ id: appt.patientId, fullName: appt.patientName }}
            initial={{
              doctorId: appt.doctorId ?? "",
              date: dateStr,
              time: timeStr,
              reason: appt.reason ?? "",
              durationMinutes: appt.durationMinutes,
            }}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Permanently delete this appointment (use Cancel to just call it off).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAppointmentButton appointmentId={appt.id} />
        </CardContent>
      </Card>
    </div>
  );
}
