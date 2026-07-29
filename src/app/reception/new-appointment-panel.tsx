import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { patients, users } from "@/core/db/schema";
import { getClinic } from "@/core/clinics/get-clinic";
import { formatMrn } from "@/core/patients/mrn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { NewAppointmentForm } from "./new-appointment-form";
import { getBookingProcedures } from "@/core/appointments/procedures";
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
}: {
  clinicId: string;
  backHref: string;
  /** Start with this patient chosen (from "Book" on a patient row). */
  preselectedPatientId?: string;
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
  const patientCols = {
    id: patients.id,
    fullName: patients.fullName,
    phone: patients.phone,
    mrn: patients.mrn,
    createdAt: patients.createdAt,
  };

  const [recentRows, doctors, bookingProcedures, preselectedRow] = await Promise.all([
    db
      .select(patientCols)
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, notDeleted(patients.deletedAt)))
      .orderBy(desc(patients.createdAt))
      .limit(10),
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        flexibleHours: users.flexibleHours,
        consultationFee: users.consultationFee,
      })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          notDeleted(users.deletedAt),
          inArray(users.role, ["doctor"]),
        ),
      )
      .orderBy(desc(users.createdAt)),
    getBookingProcedures(clinicId),
    preselectedPatientId
      ? db
          .select(patientCols)
          .from(patients)
          .where(
            byClinic(
              patients.clinicId,
              clinicId,
              notDeleted(patients.deletedAt),
              eq(patients.id, preselectedPatientId),
            ),
          )
          .limit(1)
          .then((r) => r[0] ?? null)
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
