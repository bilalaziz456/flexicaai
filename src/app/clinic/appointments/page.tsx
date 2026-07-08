import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  confirmed: "default",
  scheduled: "secondary",
};

/**
 * Clinic Admin: read-only view of all UPCOMING appointments for the clinic
 * (scheduled/confirmed, from now on, soonest first). Scheduling and status
 * changes stay in the receptionist panel — the owner only needs visibility.
 * Matches the dashboard "Upcoming appts" count. Clinic-scoped via byClinic().
 */
export default async function ClinicAppointmentsPage() {
  const { clinicId } = await requireClinicAdmin();
  const now = new Date();

  const rows = await db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      status: appointments.status,
      reason: appointments.reason,
      patientName: patients.fullName,
      doctorName: users.fullName,
      doctorUsername: users.username,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .leftJoin(users, eq(appointments.doctorId, users.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        and(
          inArray(appointments.status, ["scheduled", "confirmed"]),
          gte(appointments.scheduledAt, now),
        ),
      ),
    )
    .orderBy(asc(appointments.scheduledAt))
    .limit(200);

  const fmt = (d: Date) =>
    d.toLocaleString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const doctorLabel = (name: string | null, username: string | null) =>
    name ?? username ?? "Any doctor";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Upcoming appointments</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} upcoming appointment{rows.length === 1 ? "" : "s"}.
          Reception schedules and updates these.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No upcoming appointments.
        </div>
      ) : (
        <>
          {/* Desktop: full table. */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{fmt(a.scheduledAt)}</TableCell>
                    <TableCell>{a.patientName}</TableCell>
                    <TableCell>{doctorLabel(a.doctorName, a.doctorUsername)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                        {a.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards — no horizontal scroll. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((a) => (
              <li key={a.id} className="space-y-1 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.patientName}</span>
                  <Badge variant={STATUS_VARIANT[a.status] ?? "secondary"}>
                    {a.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {fmt(a.scheduledAt)} · {doctorLabel(a.doctorName, a.doctorUsername)}
                  {a.reason ? ` · ${a.reason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
