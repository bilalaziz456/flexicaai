import Link from "next/link";
import { getPatientForPicker, listRecentPatients } from "@/core/patients/list";
import { getClinic } from "@/core/clinics/get-clinic";
import { formatMrn } from "@/core/patients/mrn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { NewAppointmentForm } from "@/app/clinic/appointments/new-appointment-form";
import { getBookingProcedures } from "@/core/appointments/procedures";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { getUnscheduledItems } from "@/core/patients/treatment-plans";

/**
 * The "schedule a new appointment" panel — shared by any panel that can create
 * appointments (reception + a doctor granted `appointments:create`). The caller
 * does the permission gate; `backHref` is where the ← link + post-save land.
 */
export async function NewAppointmentPanel({
  clinicId,
  backHref,
  preselectedPatientId,
  preselectedDate,
}: {
  clinicId: string;
  backHref: string;
  /** Start with this patient chosen (from "Book" on a patient row). */
  preselectedPatientId?: string;
  /** Start on this date (from "New appointment" on the list, which carries the day
   *  the calendar is showing). Already validated as YYYY-MM-DD by the caller. */
  preselectedDate?: string;
}) {
  const clinic = await getClinic(clinicId);
  const toPatient = (p: {
    id: string;
    fullName: string;
    phone: string | null;
    mrn: number | null;
    createdAt: Date;
  }) => ({
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    mrn: formatMrn(clinic?.mrnPrefix, p.mrn, p.createdAt),
  });
  const [recentRows, doctors, bookingProcedures, preselectedRow] = await Promise.all([
    listRecentPatients(clinicId),
    // `newest` preserves this picker's existing order (see appointment-detail).
    listClinicDoctors(clinicId, { order: "newest" }),
    getBookingProcedures(clinicId),
    preselectedPatientId
      ? getPatientForPicker(clinicId, preselectedPatientId)
      : Promise.resolve(null),
  ]);
  const recentPatients = recentRows.map(toPatient);
  const preselectedPatient = preselectedRow ? toPatient(preselectedRow) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to appointments
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New appointment</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>Pick a patient and a date &amp; time.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm
            initialPatients={recentPatients}
            doctors={doctors}
            procedures={bookingProcedures}
            preselectedPatient={preselectedPatient}
            preselectedDate={preselectedDate}
            planItems={
              preselectedPatientId
                ? (await getUnscheduledItems(clinicId, preselectedPatientId)).map((i) => ({
                    id: i.id,
                    name: i.name,
                    tooth: i.tooth,
                    unitPrice: i.unitPrice,
                    quantity: i.quantity,
                    planTitle: i.planTitle,
                  }))
                : []
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
