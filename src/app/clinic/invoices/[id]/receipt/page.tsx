import { redirect } from "next/navigation";

/** The receipt is gone — the invoice is the patient's paper (see the appointment
 *  receipt route). An old link lands on the invoice's print screen. */
export default async function InvoiceReceiptRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/clinic/invoices/${id}/print`);
}
