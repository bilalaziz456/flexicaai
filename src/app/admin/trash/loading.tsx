import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the admin trash list. The PanelShell persists around it. */
export default function AdminTrashLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
