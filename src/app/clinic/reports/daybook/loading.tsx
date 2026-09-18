import { StatsTableSkeleton } from "@/core/ui/panel-skeleton";

/** The day book: five cash totals over the by-method table. The PanelShell persists around it. */
export default function ClinicDaybookLoading() {
  return <StatsTableSkeleton {...{ kpis: 5, cols: 4 }} />;
}
