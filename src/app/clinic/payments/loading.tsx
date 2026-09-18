import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the payments ledger. The PanelShell persists around it. */
export default function ClinicPaymentsLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
