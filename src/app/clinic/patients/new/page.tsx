import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { sanitisePhoneInput } from "@/core/lib/phone";
import { NewPatientPanel } from "../new-patient-panel";
import { nextMrnLabel } from "@/core/patients/mrn-series";

/**
 * Clinic workspace: register a patient (needs `patients:create`).
 *
 * Optional prefills, from "Create patient" in the top-bar search when nothing matched:
 *   `?phone=` / `?name=` — what was typed, so the desk does not type it twice.
 *   `?then=book`         — on save, go straight to booking this patient.
 */
export default async function NewPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; name?: string; then?: string }>;
}) {
  const user = await requireWorkspace("patients", "create");
  const clinic = await getClinic(user.clinicId);
  const { phone, name, then } = await searchParams;
  return (
    <NewPatientPanel
      backHref="/clinic/patients"
      defaults={{
        // Only what the phone field could have held anyway; the name is capped
        // because it arrives from a URL, not from the form.
        phone: phone ? sanitisePhoneInput(phone) : undefined,
        fullName: name?.trim().slice(0, 120) || undefined,
      }}
      thenBook={then === "book"}
      nextMrn={clinic ? nextMrnLabel(clinic) : null}
      canBook={can(user, "appointments", "create")}
      canInvoice={
        clinicHasFeature(clinic?.featuresEnabled, "sales") &&
        can(user, "billing", "create") &&
        can(user, "appointments", "create")
      }
    />
  );
}
