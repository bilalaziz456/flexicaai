import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the invoice register. The PanelShell persists around it. */
export default function ClinicInvoicesLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
