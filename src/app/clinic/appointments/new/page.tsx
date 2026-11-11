import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { clinicHasFeature } from "@/core/lib/features";
import { getClinic } from "@/core/clinics/get-clinic";
import { FlashToast } from "@/core/ui/toast";
import { NewAppointmentPanel } from "@/app/clinic/appointments/new-appointment-panel";
import { localDateStr } from "@/core/appointments/availability";

/** YYYY-MM-DD. Matched here rather than trusted: the value is fed straight into a
 *  `<input type="date">` and into the doctor-availability lookup, and anything else
 *  would leave the field visibly blank with no hint why. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Clinic workspace: schedule a new appointment (needs `appointments:create`).
 *
 * Two optional prefills, both arriving as query params so the form stays a plain
 * link away from wherever the intent was formed:
 *   `?patientId=` — from "Book" on a patient row or detail page.
 *   `?date=`      — from the add button on a day of the list's calendar. The
 *                   list's New appointment button sends none (owner, 2026-11-12).
 *                   Without one the form opens on TODAY (owner, 2026-11-12), the
 *                   server's date like New invoice, so the doctor's times and the
 *                   appointment number appear as soon as a doctor is picked.
 *   `?patientCreated=1` — the patient was just registered from the search box;
 *                   the toast belongs here, since this is where the save landed.
 */
export default async function ClinicNewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; date?: string; patientCreated?: string }>;
}) {
  const user = await requireWorkspace("appointments", "create");
  const clinic = await getClinic(user.clinicId);
  // An advance can be taken with the booking when the clinic bills and this person
  // may record payments (the action re-checks).
  const canTakePayment = clinicHasFeature(clinic?.featuresEnabled, "sales") && can(user, "billing", "create");
  const { patientId, date, patientCreated } = await searchParams;
  return (
    <>
      <FlashToast
        message={patientCreated ? "Patient added successfully." : null}
        params={["patientCreated"]}
      />
      <NewAppointmentPanel
        clinicId={user.clinicId}
        backHref="/clinic/appointments"
        preselectedPatientId={patientId}
        preselectedDate={date && YMD.test(date) ? date : localDateStr(new Date())}
        canTakePayment={canTakePayment}
        canChangePrice={can(user, "bill_price", "edit")}
      />
    </>
  );
}
