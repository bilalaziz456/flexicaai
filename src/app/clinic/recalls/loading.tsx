import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the recalls list. The PanelShell persists around it. */
export default function ClinicRecallsLoading() {
  return <TableSkeleton {...{ cols: 4 }} />;
}
