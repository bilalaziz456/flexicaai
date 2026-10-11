import AppointmentReceiptPrint from "@/app/clinic/appointments/[id]/receipt/page";

/** The receipt's print screen at an INVOICES address (see ../print/page.tsx). */
export default async function InvoiceReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  return AppointmentReceiptPrint({ params, searchParams: Promise.resolve({ from: "invoice" }) });
}
