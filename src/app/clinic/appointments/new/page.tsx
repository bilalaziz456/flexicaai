import { requireWorkspace } from "@/core/auth/user";
import { FlashToast } from "@/core/ui/toast";
import { NewAppointmentPanel } from "@/app/clinic/appointments/new-appointment-panel";

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
 *   `?date=`      — from "New appointment" on the list, carrying whichever day the
 *                   calendar is showing, so picking a date and then New keeps it.
 *   `?patientCreated=1` — the patient was just registered from the search box;
 *                   the toast belongs here, since this is where the save landed.
 */
export default async function ClinicNewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string; date?: string; patientCreated?: string }>;
}) {
  const user = await requireWorkspace("appointments", "create");
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
        preselectedDate={date && YMD.test(date) ? date : undefined}
      />
    </>
  );
}
