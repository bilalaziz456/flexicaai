import { TableSkeleton } from "@/core/ui/panel-skeleton";

/** The services price list. The PanelShell persists around it. */
export default function ClinicServicesLoading() {
  return <TableSkeleton {...{ cols: 4 }} />;
}
