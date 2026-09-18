import { StatsTableSkeleton } from "@/core/ui/panel-skeleton";

/** The doctor schedule: three counts over the week grid. The PanelShell persists around it. */
export default function ClinicScheduleLoading() {
  return <StatsTableSkeleton {...{ kpis: 3, rows: 6, cols: 8 }} />;
}
