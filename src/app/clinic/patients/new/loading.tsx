import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** The patient registration form. The PanelShell persists around it. */
export default function ClinicNewPatientLoading() {
  return <FormSkeleton {...{ fields: 6 }} />;
}
