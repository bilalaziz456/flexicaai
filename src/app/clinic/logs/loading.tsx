import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the activity log. The PanelShell persists around it. */
export default function ClinicLogsLoading() {
  return <TableSkeleton {...{ cols: 4 }} />;
}
