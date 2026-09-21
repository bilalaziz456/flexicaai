import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** Loading shape for the patients list. The PanelShell persists around it. */
export default function ClinicPatientsLoading() {
  return <TableSkeleton {...{ cols: 4 }} />;
}
