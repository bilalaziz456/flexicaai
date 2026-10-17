import { clinicHasFeature } from "@/core/lib/features";
import { offeredPapers } from "@/core/lib/print-papers";
import { BackLink } from "@/core/ui/back-link";
import { getPatientForPicker, listRecentPatients } from "@/core/patients/list";
import { getClinic } from "@/core/clinics/get-clinic";
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
import { getBookablePlanItems } from "@/core/patients/treatment-plans";

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
  preselectedTime,
  invoiceMode = false,
  canTakePayment = false,
}: {
  clinicId: string;
  backHref: string;
  /** Start with this patient chosen (from "Book" on a patient row). */
  preselectedPatientId?: string;
  /** Start on this date (from "New appointment" on the list, which carries the day
   *  the calendar is showing). Already validated as YYYY-MM-DD by the caller. */
  preselectedDate?: string;
  preselectedTime?: string;
  /** The Invoices page's "New invoice": same form, plus the payment, and the visit is
   *  created with its invoice (see NewAppointmentForm's `invoiceMode`). */
  invoiceMode?: boolean;
  /** Offer an optional payment on a new appointment (see the form). */
  canTakePayment?: boolean;
}) {
  const clinic = await getClinic(clinicId);
  const toPatient = (p: {
    id: string;
    fullName: string;
    phone: string | null;
    mrn: number | null;
    mrnLabel: string | null;
    createdAt: Date;
  }) => ({
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    mrn: p.mrnLabel,
  });
  const [recentRows, doctors, bookingProcedures, preselectedRow] = await Promise.all([
    listRecentPatients(clinicId),
    // `newest` preserves this picker's existing order (see appointment-detail).
    listClinicDoctors(clinicId, { order: "newest" }),
    getBookingProcedures(clinicId, { includeServices: true }),
    preselectedPatientId
      ? getPatientForPicker(clinicId, preselectedPatientId)
      : Promise.resolve(null),
  ]);
  const recentPatients = recentRows.map(toPatient);
  const preselectedPatient = preselectedRow ? toPatient(preselectedRow) : null;

  return (
    <div className="space-y-6">
      <div>
        <BackLink href={backHref}>
          {invoiceMode ? "Back to invoices" : "Back to appointments"}
        </BackLink>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
          {invoiceMode ? "New invoice" : "New appointment"}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{invoiceMode ? "Invoice" : "Schedule"}</CardTitle>
          <CardDescription>
            {invoiceMode
              ? "Patient, doctor, date & time, procedures and the payment received. The visit is created with its invoice number."
              : "Pick a patient and a date & time."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewAppointmentForm
            clinicName={clinic?.name}
            papers={offeredPapers(clinic?.invoicePapersEnabled)}
            initialPatients={recentPatients}
            doctors={doctors}
            procedures={bookingProcedures}
            chargesEnabled={clinicHasFeature(clinic?.featuresEnabled, "sales")}
            preselectedPatient={preselectedPatient}
            preselectedDate={preselectedDate}
            preselectedTime={preselectedTime}
            invoiceMode={invoiceMode}
            canTakePayment={canTakePayment}
            planItems={
              preselectedPatientId
                ? await getBookablePlanItems(clinicId, preselectedPatientId)
                : []
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
