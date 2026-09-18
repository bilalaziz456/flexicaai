import { StatsTableSkeleton } from "@/core/ui/panel-skeleton";

/** Imported history: five totals over the archive table. The PanelShell persists around it. */
export default function ClinicHistoryLoading() {
  return <StatsTableSkeleton {...{ kpis: 5, cols: 5 }} />;
}
