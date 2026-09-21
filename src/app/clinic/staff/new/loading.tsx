import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** The add-staff form. The PanelShell persists around it. */
export default function ClinicNewStaffLoading() {
  return <FormSkeleton {...{ fields: 6 }} />;
}
