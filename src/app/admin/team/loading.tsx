import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** The internal team list. The PanelShell persists around it. */
export default function AdminTeamLoading() {
  return <TableSkeleton {...{ cols: 4 }} />;
}
