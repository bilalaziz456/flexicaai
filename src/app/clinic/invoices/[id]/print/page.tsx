import AppointmentInvoicePrint from "@/app/clinic/appointments/[id]/invoice/page";

/**
 * The invoice's print screen, at an INVOICES address — so the menu, the tab and the
 * breadcrumb say Invoices, and Back returns to the invoice (owner's report: printing
 * from an invoice landed on the appointment's print screen). One print layout, shown
 * in two places: this renders the same page with `from=invoice`.
 */
export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const sp = await searchParams;
  return AppointmentInvoicePrint({ params, searchParams: Promise.resolve({ ...sp, from: "invoice" }) });
}
