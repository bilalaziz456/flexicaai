import { StatsTableSkeleton } from "@/core/ui/panel-skeleton";

/** Company opex: totals over the expense ledger. The PanelShell persists around it. */
export default function AdminCompanyExpensesLoading() {
  return <StatsTableSkeleton {...{ kpis: 3, cols: 5 }} />;
}
