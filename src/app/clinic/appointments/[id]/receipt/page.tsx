import { redirect } from "next/navigation";

/**
 * The separate payment receipt is gone (owner's call, 2026-10-12): the INVOICE is the
 * one paper a patient gets, and it already shows every payment, refund and the
 * balance due. Kept as a redirect so an old link or bookmark still lands on it.
 */
export default async function ReceiptRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/clinic/appointments/${id}/invoice`);
}
