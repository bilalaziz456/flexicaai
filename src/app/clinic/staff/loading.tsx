import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the staff list. The PanelShell persists around it. */
export default function ClinicStaffLoading() {
  return <TableSkeleton {...{ cols: 4 }} />;
}
