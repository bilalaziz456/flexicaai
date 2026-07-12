import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, patients, users } from "@/core/db/schema";
import { Badge } from "@/core/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { ViewLogger } from "@/core/ui/view-logger";
import {
  getAppointmentProcedureItems,
  getBookingProcedures,
} from "@/core/appointments/procedures";
import {
  computeAppointmentTotal,
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
      chargeConsultation: appointments.chargeConsultation,
      patientId: patients.id,
      patientName: patients.fullName,
    })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.id))
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
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
      .where(byClinic(users.clinicId, clinicId, inArray(users.role, ["doctor"])))
      .orderBy(desc(users.createdAt)),
    getBookingProcedures(clinicId),
    getAppointmentProcedureItems(clinicId, appointmentId),
  ]);

  // Edit-form prefill: only the items that still map to a selectable procedure.
  const initialProcedures = procedureItems
    .filter((i): i is typeof i & { procedureId: string } => Boolean(i.procedureId))
    .map((i) => ({ procedureId: i.procedureId, quantity: i.quantity }));

  // Read-only bill: consultation fee + line items, with the appointment's discount.
  // A procedure-only visit doesn't charge the consultation fee (chargeConsultation).
  const doctorFee = appt.chargeConsultation
    ? (doctors.find((dd) => dd.id === appt.doctorId)?.consultationFee ?? 0)
    : 0;
  const proceduresTotal = procedureItems.reduce(
    (sum, i) => sum + i.unitPrice * i.quantity,
    0,
  );
  const discountType = normalizeDiscountType(appt.discountType);
  const bill = computeAppointmentTotal(
    doctorFee,
    proceduresTotal,
    discountType,
    appt.discountValue,
  );

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
        </div>
        <p className="text-sm text-muted-foreground">{whenLabel}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Confirm, complete, cancel or mark no-show.</CardDescription>
        </CardHeader>
        <CardContent>
          <AppointmentActions id={appt.id} status={appt.status} />
        </CardContent>
      </Card>

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
              {procedureItems.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between gap-3">
                  <dt className="min-w-0 truncate text-muted-foreground">
                    {i.name}
                    {i.quantity > 1 ? (
                      <span> × {i.quantity} @ {formatPkr(i.unitPrice)}</span>
                    ) : null}
                  </dt>
                  <dd className="tabular-nums">{formatPkr(i.unitPrice * i.quantity)}</dd>
                </div>
              ))}
              {bill.discount > 0 ? (
                <>
                  <div className="flex items-center justify-between border-t pt-2">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="tabular-nums">{formatPkr(bill.gross)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">
                      Discount
                      {discountType === "percent" ? ` (${appt.discountValue}%)` : ""}
                    </dt>
                    <dd className="tabular-nums text-destructive">
                      −{formatPkr(bill.discount)}
                    </dd>
                  </div>
                </>
              ) : null}
              <div className="flex items-center justify-between border-t pt-2 text-base font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPkr(bill.net)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

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
              chargeConsultation: appt.chargeConsultation,
              procedures: initialProcedures,
            }}
          />
        </CardContent>
      </Card>

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
    </div>
  );
}
