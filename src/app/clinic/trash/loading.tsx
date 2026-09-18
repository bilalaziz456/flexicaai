import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the trash list. The PanelShell persists around it. */
export default function ClinicTrashLoading() {
  return <TableSkeleton {...{ cols: 5 }} />;
}
