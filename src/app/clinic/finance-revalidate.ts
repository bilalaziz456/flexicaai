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
  // The petty-cash drawer READS these ledgers rather than keeping its own, so a cash
  // payment, a cash expense or a doctor paid in notes all change what should be in the
  // box — from a screen nowhere near it. Listed here for the same reason as the others.
  //
  // HONESTLY: this line is belt-and-braces, not a fix. Every page in this list reads
  // the session, so none is ever statically cached, and the client refetches a dynamic
  // route on navigation regardless. Removing it and repeating the cross-page test
  // showed the drawer updating anyway. It is here so the newest money surface is not
  // the one somebody forgets when route caching does start to matter.
  revalidatePath("/clinic/cash");
}
