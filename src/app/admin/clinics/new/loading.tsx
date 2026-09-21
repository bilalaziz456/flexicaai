import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** The new-clinic form. The PanelShell persists around it. */
export default function AdminNewClinicLoading() {
  return <FormSkeleton {...{ fields: 8 }} />;
}
