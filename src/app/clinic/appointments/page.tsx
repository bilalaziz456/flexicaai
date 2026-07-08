import Link from "next/link";
import { Plus } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { requireClinicAdmin } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
// Reuse the receptionist's status controls — appointment management is shared,
// and the underlying actions now accept clinic_admin too.
import { AppointmentActions } from "@/app/reception/appointment-actions";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  confirmed: "default",
  completed: "default",
  scheduled: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};

/**
 * Clinic Admin: manage the clinic's appointments — same capabilities as the
 * receptionist (schedule, confirm, complete, cancel, no-show). Clinic-scoped via
 * byClinic(); the shared actions route back here (not /reception) for this role.
 */
export default async function ClinicAppointmentsPage() {
  const { clinicId } = await requireClinicAdmin();

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
    .where(byClinic(appointments.clinicId, clinicId))
    .orderBy(desc(appointments.scheduledAt))
    .limit(100);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} appointment{rows.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Link
          href="/clinic/appointments/new"
          className={cn(buttonVariants(), "hidden sm:inline-flex")}
        >
          New appointment
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          No appointments yet. Schedule the first one.
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
                  <TableHead className="text-right">Actions</TableHead>
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
                    <TableCell>
                      <AppointmentActions id={a.id} status={a.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: stacked cards — no horizontal scroll; icon-only actions. */}
          <ul className="space-y-3 md:hidden">
            {rows.map((a) => (
              <li key={a.id} className="space-y-2 rounded-md border p-3">
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
                <AppointmentActions id={a.id} status={a.status} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Mobile FAB. */}
      <Link
        href="/clinic/appointments/new"
        aria-label="New appointment"
        className={cn(
          buttonVariants({ size: "icon" }),
          "fixed bottom-6 right-6 z-50 size-14 rounded-full shadow-lg sm:hidden",
        )}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Link>
    </div>
  );
}
