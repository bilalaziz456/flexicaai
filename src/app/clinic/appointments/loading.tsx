import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the appointments list. The PanelShell persists around it. */
export default function ClinicAppointmentsLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
