import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** The admin's own account settings. The PanelShell persists around it. */
export default function AdminAccountLoading() {
  return <FormSkeleton {...{ fields: 5 }} />;
}
