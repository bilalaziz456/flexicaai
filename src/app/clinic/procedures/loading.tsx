import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** The procedure catalog. The PanelShell persists around it. */
export default function ClinicProceduresLoading() {
  return <TableSkeleton {...{ cols: 4 }} />;
}
