import { revalidatePath } from "next/cache";

/**
 * Revalidate every finance surface after a change to collected revenue / bills /
 * discounts (a payment, refund, void, completion, edit, or discount approval), so
 * the dashboard KPIs and the reports never show stale figures. Called from the
 * relevant server actions in addition to the per-record paths.
 */
export function revalidateFinance() {
  revalidatePath("/clinic"); // dashboard KPIs (Collected / Outstanding / …)
  revalidatePath("/clinic/sales");
  revalidatePath("/clinic/discounts");
  revalidatePath("/clinic/shares");
  revalidatePath("/clinic/pl");
  revalidatePath("/clinic/reports/daybook");
}
