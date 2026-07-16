import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getAppointmentBill } from "@/core/billing/bill";
import { getPatientCredit, listAppointmentPayments } from "@/core/billing/payments";
import { getInvoiceForAppointment } from "@/core/billing/invoice";
import { PaymentPanel } from "./payment-panel";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ViewLogger } from "@/core/ui/view-logger";
import { getCurrentUser } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import {
  getAppointmentProcedureItems,
  getBookingProcedures,
} from "@/core/appointments/procedures";
import {
  computeBill,
  effectiveDiscountValue,
  formatPkr,
  normalizeDiscountType,
} from "@/core/appointments/fee";
import { AppointmentActions } from "./appointment-actions";
import { DeleteAppointmentButton } from "./edit-appointment-form";
import { NewAppointmentForm } from "./new-appointment-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  confirmed: "default",
  completed: "default",
  scheduled: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
};
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Shared appointment detail (used by /clinic/appointments/[id] and
 * /reception/appointments/[id]). Clinic-scoped fetch; edit + status + delete.
 */
export async function AppointmentDetail({
  clinicId,
  appointmentId,
  backHref,
}: {
  clinicId: string;
  appointmentId: string;
  backHref: string;
}) {
  const [appt] = await db
    .select({
      id: appointments.id,
      doctorId: appointments.doctorId,
      scheduledAt: appointments.scheduledAt,
      durationMinutes: appointments.durationMinutes,
      status: appointments.status,
      reason: appointments.reason,
      source: appointments.source,
      discountType: appointments.discountType,
      discountValue: appointments.discountValue,
      discountBorneBy: appointments.discountBorneBy,
      discountSplitType: appointments.discountSplitType,
      discountSplitValue: appointments.discountSplitValue,
      discountStatus: appointments.discountStatus,
      chargeConsultation: appointments.chargeConsultation,
      patientId: patients.id,
      patientName: patients.fullName,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .where(
      byClinic(
        appointments.clinicId,
        clinicId,
        notDeleted(appointments.deletedAt),
        eq(appointments.id, appointmentId),
      ),
    )
    .limit(1);
  if (!appt) notFound();

  const [doctors, bookingProcedures, procedureItems] = await Promise.all([
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        flexibleHours: users.flexibleHours,
        consultationFee: users.consultationFee,
      })
      .from(users)
      .where(
        byClinic(
          users.clinicId,
          clinicId,
          notDeleted(users.deletedAt),
          inArray(users.role, ["doctor"]),
        ),
      )
      .orderBy(desc(users.createdAt)),
    getBookingProcedures(clinicId),
    getAppointmentProcedureItems(clinicId, appointmentId),
  ]);

  // Edit-form prefill: only the items that still map to a selectable procedure
  // (carry each line's quantity + its own discount).
  const initialProcedures = procedureItems
    .filter((i): i is typeof i & { procedureId: string } => Boolean(i.procedureId))
    .map((i) => ({
      procedureId: i.procedureId,
      quantity: i.quantity,
      discountType: i.discountType,
      discountValue: i.discountValue,
    }));

  // Read-only bill: consultation fee + line items (each with its own discount),
  // then the appointment-level discount on the subtotal. A procedure-only visit
  // doesn't charge the consultation fee (chargeConsultation).
  const doctorFee = appt.chargeConsultation
    ? (doctors.find((dd) => dd.id === appt.doctorId)?.consultationFee ?? 0)
    : 0;
  const discountType = normalizeDiscountType(appt.discountType);
  // A discount awaiting approval (or rejected) doesn't apply yet — show the bill at
  // full price with a status note. `discountBlocked` drives that note/badge.
  const discountBlocked =
    appt.discountStatus === "pending" || appt.discountStatus === "rejected";
  const bill = computeBill(
    doctorFee,
    procedureItems.map((i) => ({
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      discountType: i.discountType,
      discountValue: i.discountValue,
    })),
    discountType,
    effectiveDiscountValue(appt.discountStatus, appt.discountValue),
  );

  // Permission gates: hide the controls the current user can't use (the server
  // actions enforce the same, so this is UX, not the security boundary).
  const currentUser = await getCurrentUser();
  const canEdit = currentUser ? can(currentUser, "appointments", "edit") : false;
  const canDelete = currentUser ? can(currentUser, "appointments", "delete") : false;

  // Billing (Finance) — shown when the clinic has the sales feature and the user can
  // view billing. Bill = the approval-gated net; collected + status come from the
  // ledger. The panel handles collect / apply-advance / void / invoice per ACL.
  const [clinicRow] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  const billingOn =
    clinicHasFeature(clinicRow?.featuresEnabled, "sales") &&
    Boolean(currentUser && can(currentUser, "billing", "view"));
  const [aBill, credit, ledger, invoice] = billingOn
    ? await Promise.all([
        getAppointmentBill(clinicId, appointmentId),
        getPatientCredit(clinicId, appt.patientId),
        listAppointmentPayments(clinicId, appointmentId),
        getInvoiceForAppointment(clinicId, appointmentId),
      ])
    : [null, 0, [], null];

  const d = appt.scheduledAt;
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const whenLabel = d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <ViewLogger
        entity="appointment"
        entityId={appt.id}
        summary={`Viewed appointment for ${appt.patientName}`}
      />
      <div>
        <Link
          href={backHref}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Back to appointments
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{appt.patientName}</h1>
          <Badge variant={STATUS_VARIANT[appt.status] ?? "secondary"}>
            {appt.status.replace("_", " ")}
          </Badge>
          {appt.source === "whatsapp" ? (
            <Badge variant="outline">via WhatsApp</Badge>
          ) : null}
          {appt.discountValue > 0 && appt.discountStatus === "pending" ? (
            <Badge variant="secondary">Discount pending approval</Badge>
          ) : appt.discountValue > 0 && appt.discountStatus === "rejected" ? (
            <Badge variant="destructive">Discount rejected</Badge>
          ) : appt.discountValue > 0 && appt.discountStatus === "approved" ? (
            <Badge variant="outline">Discount approved</Badge>
          ) : null}
          {billingOn && aBill && aBill.status === "completed" && aBill.billTotal > 0 ? (
            aBill.paymentStatus === "paid" ? (
              <Badge variant="outline">Paid</Badge>
            ) : aBill.paymentStatus === "partial" ? (
              <Badge variant="secondary">Partial · Rs {aBill.outstanding.toLocaleString("en-PK")} left</Badge>
            ) : (
              <Badge variant="destructive">Unpaid</Badge>
            )
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{whenLabel}</p>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>Confirm, complete, cancel or mark no-show.</CardDescription>
          </CardHeader>
          <CardContent>
            <AppointmentActions id={appt.id} status={appt.status} />
          </CardContent>
        </Card>
      ) : null}

      {/* Read-only bill: what the patient pays for this visit. Shown whenever
          there's a fee or a procedure; a discount line appears only if applied. */}
      {bill.gross > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Bill</CardTitle>
            <CardDescription>
              Consultation fee, procedures and discount for this visit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {bill.consultation > 0 ? (
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Consultation fee</dt>
                  <dd className="tabular-nums">{formatPkr(bill.consultation)}</dd>
                </div>
              ) : null}
              {procedureItems.map((i, idx) => {
                const l = bill.lines[idx];
                return (
                  <div key={idx} className="flex items-center justify-between gap-3">
                    <dt className="min-w-0 truncate text-muted-foreground">
                      {i.name}
                      {i.quantity > 1 ? (
                        <span> × {i.quantity} @ {formatPkr(i.unitPrice)}</span>
                      ) : null}
                      {l.discount > 0 ? (
                        <span className="text-destructive">
                          {" "}· −{formatPkr(l.discount)}
                          {i.discountType === "percent" ? ` (${i.discountValue}%)` : ""}
                        </span>
                      ) : null}
                    </dt>
                    <dd className="tabular-nums">{formatPkr(l.net)}</dd>
                  </div>
                );
              })}
              {bill.appointmentDiscount > 0 ? (
                <>
                  <div className="flex items-center justify-between border-t pt-2">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="tabular-nums">{formatPkr(bill.subtotal)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">
                      Appointment discount
                      {discountType === "percent" ? ` (${appt.discountValue}%)` : ""}
                    </dt>
                    <dd className="tabular-nums text-destructive">
                      −{formatPkr(bill.appointmentDiscount)}
                    </dd>
                  </div>
                </>
              ) : null}
              <div className="flex items-center justify-between border-t pt-2 text-base font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPkr(bill.net)}</dd>
              </div>
              {discountBlocked && appt.discountValue > 0 ? (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {appt.discountStatus === "rejected"
                    ? "A discount was entered but was rejected — it is not applied. Edit the appointment to re-submit."
                    : "A discount is awaiting approval and is not applied yet. It will apply once approved."}
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {/* Payment — collect / apply advance / void / invoice (Finance). */}
      {billingOn && aBill ? (
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
            <CardDescription>
              What the patient owes for this visit, and what&apos;s been collected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentPanel
              appointmentId={appt.id}
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
              canCollect={Boolean(currentUser && can(currentUser, "billing", "create"))}
              canVoidRefund={Boolean(currentUser && can(currentUser, "billing", "delete"))}
              canInvoice={Boolean(currentUser && can(currentUser, "billing", "create"))}
              invoiceLabel={invoice?.label ?? null}
              invoiceHref={`/clinic/appointments/${appt.id}/invoice`}
            />
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Edit</CardTitle>
            <CardDescription>
              Change the doctor, date &amp; time, duration, procedures or reason.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewAppointmentForm
              doctors={doctors}
              initialPatients={[]}
              procedures={bookingProcedures}
              appointmentId={appt.id}
              fixedPatient={{ id: appt.patientId, fullName: appt.patientName }}
              initial={{
                doctorId: appt.doctorId ?? "",
                date: dateStr,
                time: timeStr,
                reason: appt.reason ?? "",
                durationMinutes: appt.durationMinutes,
                discountType: discountType,
                discountValue: appt.discountValue,
                discountBorneBy: appt.discountBorneBy,
                discountSplitType: appt.discountSplitType,
                discountSplitValue: appt.discountSplitValue,
                chargeConsultation: appt.chargeConsultation,
                procedures: initialProcedures,
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {canDelete ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Permanently delete this appointment (use Cancel to just call it off).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteAppointmentButton appointmentId={appt.id} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
