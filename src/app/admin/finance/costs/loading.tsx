import { FormSkeleton } from "@/core/ui/panel-skeleton";

/** The serving-cost rate card. The PanelShell persists around it. */
export default function AdminCostRatesLoading() {
  return <FormSkeleton {...{ fields: 7 }} />;
}
