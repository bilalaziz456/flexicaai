import Link from "next/link";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { getAppointmentDetail } from "@/core/appointments/list-query";
import { listClinicDoctors } from "@/core/appointments/doctors";
import { getAppointmentProcedureItems, getBookingProcedures } from "@/core/appointments/procedures";
import { normalizeDiscountType, formatPkr } from "@/core/appointments/fee";
import { getAppointmentBill } from "@/core/billing/bill";
import { getPatientCredit, listAppointmentPayments } from "@/core/billing/payments";
import { getInvoiceForAppointment } from "@/core/billing/invoice";
import { paymentStatusBadge, visitPaymentStatus } from "@/core/billing/payment-status";
import { BackLink } from "@/core/ui/back-link";
import { Badge } from "@/core/ui/badge";
import { buttonVariants } from "@/core/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { FlashToast } from "@/core/ui/toast";
import { TabTitle } from "@/core/ui/app-tabs";
import { cn } from "@/core/lib/utils";
import { NewAppointmentForm } from "@/app/clinic/appointments/new-appointment-form";
import { doctorDayAvailability } from "@/app/clinic/appointments/actions";
import { PaymentPanel } from "@/app/clinic/payments/payment-panel";
import { DeleteInvoiceButton } from "@/app/clinic/invoices/delete-invoice-button";
import { DownloadLink } from "@/core/ui/download-link";
import { PrintLinks } from "@/core/ui/print-links";
import { offeredPapers } from "@/core/lib/print-papers";
import { formatDateTime12h } from "@/core/lib/date-time";
import { PrintOnArrival } from "@/core/ui/print-on-arrival";

const pad = (n: number) => String(n).padStart(2, "0");
const whenFmt = (d: Date) => formatDateTime12h(d);

/**
 * One invoice: edit what it bills (doctor, date & time, procedures, discount — the
 * visit behind it), take or cancel payments, print, delete. The id is the VISIT's:
 * an invoice is one per visit, and the visit is what an edit changes.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; printPaper?: string }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();
  const { id } = await params;
  const { created, printPaper } = await searchParams;

  const appt = await getAppointmentDetail(clinicId, id);
  if (!appt) notFound();
  const [invoice, doctors, bookingProcedures, items, aBill, credit, ledger] = await Promise.all([
    getInvoiceForAppointment(clinicId, id),
    listClinicDoctors(clinicId, { order: "newest" }),
    getBookingProcedures(clinicId, { includeServices: true }),
    getAppointmentProcedureItems(clinicId, id),
    getAppointmentBill(clinicId, id),
    getPatientCredit(clinicId, appt.patientId),
    listAppointmentPayments(clinicId, id),
  ]);
  if (!invoice) notFound();

  const refunded = ledger.filter((e) => e.kind === "refund" && e.method !== "advance").reduce((n, e) => n + e.amount, 0);
  const status = visitPaymentStatus({
    bill: aBill.billTotal,
    collected: aBill.collected,
    refunded,
    visitStatus: appt.status,
  });
  const payBadge = status
    ? paymentStatusBadge(status, {
        outstanding: aBill.outstanding,
        extra: Math.max(0, aBill.collected - aBill.billTotal),
        visitStatus: appt.status,
        formatMoney: formatPkr,
      })
    : null;

  const deleted = invoice.deleted;
  const canEdit = !invoice.voided && can(user, "appointments", "edit");
  const canDelete = !deleted && can(user, "billing", "delete");

  const d = appt.scheduledAt;
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const initialSlots =
    canEdit && appt.doctorId ? await doctorDayAvailability(appt.doctorId, `${dateStr}T12:00`) : null;

  return (
    <div className="space-y-6">
      <TabTitle title={`Invoice · ${invoice.label}`} />
      <FlashToast message={created ? `Invoice ${invoice.label} created.` : null} params={["created"]} />
      {/* "Save & print <size>" on the New invoice form: print it now. */}
      <PrintOnArrival href={`/clinic/invoices/${id}/print`} paper={printPaper} />
      <div>
        <BackLink href="/clinic/invoices">Back to invoices</BackLink>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className={cn(
                "text-2xl font-semibold tracking-[-0.02em] tabular-nums",
                invoice.voided && "text-muted-foreground line-through",
              )}
            >
              {invoice.label}
            </h1>
            {deleted ? (
              <Badge variant="destructive">Deleted</Badge>
            ) : invoice.voided ? (
              <Badge variant="outline">Void</Badge>
            ) : null}
            {payBadge ? <Badge variant={payBadge.variant}>{payBadge.label}</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Always here: on a new invoice, and after every save. */}
            <span className="inline-flex items-center gap-2">
            <PrintLinks
              href={`/clinic/invoices/${id}/print`}
              papers={offeredPapers(clinic?.invoicePapersEnabled)}
              single="Print invoice"
              className={buttonVariants()}
            />
            <DownloadLink
              href={`/clinic/invoices/${id}/print`}
              label="Download invoice"
              className={buttonVariants({ variant: "outline" })}
            />
            </span>
            {canDelete ? (
              <DeleteInvoiceButton appointmentId={id} label={invoice.label} held={aBill.collected} />
            ) : null}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/clinic/patients/${appt.patientId}`} className="underline underline-offset-4">
            {appt.patientName}
          </Link>
          {" · "}
          {whenFmt(d)}
          {" · "}
          <Link href={`/clinic/appointments/${id}`} className="underline underline-offset-4">
            Open the visit
          </Link>
        </p>
      </div>

      {deleted ? (
        <p
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm text-destructive-text"
        >
          Deleted by {deleted.byName ?? "someone"} on {whenFmt(deleted.at)}
          {deleted.reason && deleted.reason !== "Deleted" ? ` — ${deleted.reason}` : ""}. Its visit was cancelled.
        </p>
      ) : invoice.voided ? (
        <p role="status" className="rounded-lg border well p-3 text-sm text-muted-foreground">
          Void — the visit was cancelled or became a no-show. Bringing the visit back restores this invoice.
        </p>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Invoice details</CardTitle>
            <CardDescription>
              Doctor, date &amp; time, procedures and discount. The bill updates when you save.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewAppointmentForm
              clinicName={clinic?.name}
              doctors={doctors}
              initialPatients={[]}
              procedures={bookingProcedures}
              chargesEnabled
              appointmentId={id}
              fixedPatient={{ id: appt.patientId, fullName: appt.patientName }}
              initialSlots={initialSlots}
              invoiceMode
              initial={{
                doctorId: appt.doctorId ?? "",
                date: dateStr,
                time: timeStr,
                reason: appt.reason ?? "",
                durationMinutes: appt.durationMinutes,
                discountType: normalizeDiscountType(appt.discountType),
                discountValue: appt.discountValue,
                discountBorneBy: appt.discountBorneBy,
                discountSplitType: appt.discountSplitType,
                discountSplitValue: appt.discountSplitValue,
                chargeConsultation: appt.chargeConsultation,
                customTime: appt.customTime,
                procedures: items
                  .filter((i): i is typeof i & { procedureId: string } => Boolean(i.procedureId))
                  .map((i) => ({
                    procedureId: i.procedureId,
                    quantity: i.quantity,
                    discountType: i.discountType,
                    discountValue: i.discountValue,
                    unitPrice: i.unitPrice,
                  })),
                // Kept on an edit: a one-off charge has no list item to re-select.
                otherCharges: items
                  .filter((i) => !i.procedureId && i.isService)
                  .map((i) => ({ name: i.name, unitPrice: i.unitPrice, quantity: i.quantity })),
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
          <CardDescription>What the patient owes on this invoice, and what has been received.</CardDescription>
        </CardHeader>
        <CardContent>
          <PaymentPanel
            appointmentId={id}
            billTotal={aBill.billTotal}
            collected={aBill.collected}
            outstanding={aBill.outstanding}
            paymentStatus={aBill.paymentStatus}
            credit={credit}
            ledger={ledger.map((e) => ({
              id: e.id,
              kind: e.kind,
              amount: e.amount,
              method: e.method,
              reference: e.reference,
              note: e.note,
              createdByName: e.createdByName,
              occurredAt: e.occurredAt.toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              }),
            }))}
            canCollect={!deleted && can(user, "billing", "create")}
            canRefund={can(user, "refund", "create")}
            extra={
              appt.status === "cancelled" || appt.status === "no_show"
                ? aBill.collected
                : Math.max(0, aBill.collected - aBill.billTotal)
            }
            canKeepAsCredit={!deleted && can(user, "billing", "edit")}
            canVoidPayment={can(user, "billing", "delete")}
            canVoidRefundEntry={can(user, "refund", "delete")}
            canInvoice={false}
            canSendWhatsapp={can(user, "whatsapp", "create")}
            invoiceLabel={invoice.voided ? `${invoice.label} (void)` : invoice.label}
            invoiceHref={`/clinic/invoices/${id}/print`}
            papers={offeredPapers(clinic?.invoicePapersEnabled)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
