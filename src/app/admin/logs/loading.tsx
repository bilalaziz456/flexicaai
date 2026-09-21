import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the admin activity log. The PanelShell persists around it. */
export default function AdminLogsLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
