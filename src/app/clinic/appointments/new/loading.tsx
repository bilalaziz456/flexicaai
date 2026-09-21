import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** The booking form. The PanelShell persists around it. */
export default function ClinicNewAppointmentLoading() {
  return <FormSkeleton {...{ fields: 7 }} />;
}
