import { CardGridSkeleton } from "@/core/ui/panel-skeleton";

/** The reports hub — a grid of links, not a report itself. The PanelShell persists around it. */
export default function ClinicReportsLoading() {
  return <CardGridSkeleton {...{ count: 6 }} />;
}
