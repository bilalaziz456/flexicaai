import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** The subscription-invoice register. The PanelShell persists around it. */
export default function AdminClinicInvoicesLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
