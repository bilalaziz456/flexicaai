import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** One staff record, which is a long form. The PanelShell persists around it. */
export default function ClinicStaffDetailLoading() {
  return <FormSkeleton {...{ fields: 8 }} />;
}
