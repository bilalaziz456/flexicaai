"use server";

import { clinicHasFeature } from "@/core/lib/features";
import { formatTime12h } from "@/core/lib/date-time";
import { report } from "@/core/observability";
import type { PaymentMethodCode } from "@/core/db/vocabulary-seed";
import { PAYMENT_METHODS } from "@/core/finance/payment-methods";
import { recordPayment } from "@/core/billing/payments";
import { displayStaffName } from "@/core/types/auth";
import { autoIssueInvoice } from "@/core/billing/invoice";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodErrorMessage } from "@/core/lib/zod-error";
import { MAX_DISCOUNT_PERCENT, discountError } from "@/core/appointments/fee";
import { requireRole } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import type { CurrentUser } from "@/core/types/auth";
import { verifyCurrentUserPassword } from "@/core/auth/reauth";
import {
  findAppointmentForEdit,
  insertAppointment,
  getDoctorScheduleFields,
  setDoctorDailyLimit as setDoctorDailyLimitRecord,
  softDeleteAppointment,
  updateAppointmentFields,
} from "@/core/appointments/manage";
import {
  addDoctorLeave as addDoctorLeaveRecord,
  findClinicDoctor,
  findLeave,
  softDeleteLeave,
  updateDoctorLeave as updateDoctorLeaveRange,
} from "@/core/appointments/leave";
import { findClinicPatient } from "@/core/patients/manage";
import { listRecentPatients, searchPatientsForPicker } from "@/core/patients/list";
import { getClinic } from "@/core/clinics/get-clinic";
import {
  windowKind,
  windowsForWeekday,
  type DayAvailability,
  type WindowKind,
} from "@/core/lib/availability";
import {
  checkDoctorSlot,
  countDoctorDay,
  doctorOnLeave,
  localDateStr,
} from "@/core/appointments/availability";
import { queueSessionKey, sameDoctorDay, withQueueNumber } from "@/core/appointments/queue";
import {
  applyClinicOffers,
  getAppointmentProcedureItems,
  saveAppointmentProcedures,
  type ProcedureSelection,
} from "@/core/appointments/procedures";
import { syncDiscountApprovals } from "@/core/appointments/approvals";
import { planDiscountForItems, scheduleItemsOnAppointment } from "@/core/patients/treatment-plans";
import { isPlanDiscount } from "@/core/patients/plan-bill";
import { AUTO_PRINT_ID_PARAM, AUTO_PRINT_PARAM } from "@/core/lib/print-papers";
import { randomUUID } from "node:crypto";
import { revalidateFinance } from "@/app/clinic/finance-revalidate";
import {
  recordSaleForAppointment,
  voidSaleForAppointment,
} from "@/core/sales/ledger";
import {
  notifyAppointmentBooked,
  notifyAppointmentsCancelled,
} from "@/core/notifications/appointment";
import { logActivity } from "@/core/audit/log";
import { APPOINTMENT_STATUSES, type AppointmentStatus } from "@/core/appointments/status";
import { applyAppointmentStatus, confirmAppointmentOnPayment } from "@/core/appointments/set-status";
import { findSameDayAppointments } from "@/core/appointments/same-day";
import { DISCOUNT_BEARER_CODES , DISCOUNT_TYPE_CODES } from "@/core/db/vocabulary-seed";

export type ReceptionActionState = {
  error?: string;
  saved?: boolean;
  /** Set instead of saving when the patient already has a live appointment that
   *  day: the form asks, and resubmits with `confirmDuplicate=1` if the user agrees. */
  duplicate?: { date: string; existing: string[] };
};

/**
 * Appointment management is shared by the receptionist AND the clinic admin, so
 * these actions accept either role. The `home` route (where we revalidate and
 * redirect back to) depends on which panel the user came from — sending a clinic
 * admin to /reception would just bounce off the receptionist-only guard.
 */
async function requireAppointmentsAccess(): Promise<{
  user: CurrentUser;
  clinicId: string;
  home: string;
}> {
  const user = await requireRole(["receptionist", "manager", "doctor", "clinic_admin"]);
  if (!user.clinicId) redirect("/login?error=no_access");
  // Everyone works from the unified clinic workspace now.
  return { user, clinicId: user.clinicId, home: "/clinic/appointments" };
}

const createSchema = z.object({
  patientId: z.string().uuid("Choose a patient."),
  doctorId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
      message: "Invalid doctor.",
    }),
  scheduledAt: z.string().min(1, "Pick a date & time."),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  reason: z.string().trim().optional(),
  discountType: z.enum(DISCOUNT_TYPE_CODES).default("amount"),
  discountValue: z.coerce.number().int().min(0, "Discount can't be negative.").default(0),
  discountBorneBy: z.enum(DISCOUNT_BEARER_CODES).default("clinic"),
  discountSplitType: z.enum(DISCOUNT_TYPE_CODES).default("percent"),
  discountSplitValue: z.coerce.number().int().min(0).default(0),
})
  .superRefine((v, ctx) => {
    // The bound depends on the discount TYPE, so it cannot live on the field itself:
    // a flat amount has no ceiling here (the bill clamps it), a percentage does.
    const e = discountError(v.discountType, v.discountValue);
    if (e) ctx.addIssue({ code: "custom", path: ["discountValue"], message: e });
    const se = discountError(v.discountSplitType, v.discountSplitValue);
    if (se) ctx.addIssue({ code: "custom", path: ["discountSplitValue"], message: se });
  });

/**
 * Discounts are validated against their type: a percentage can't exceed 100
 * (an amount is free — the fee itself clamps the net). Returns an error string
 * or null. Shared by create + update so the rule can't drift.
 */
function validateDiscount(type: "amount" | "percent", value: number): string | null {
  if (type === "percent" && value > 100) return "Percentage can't exceed 100.";
  return null;
}

/**
 * The booking form submits one hidden `procedure` field per chosen procedure,
 * encoded `"<procedureId>:<quantity>:<amount|percent>:<discountValue>"`. The
 * PERFORMING doctor is the appointment's own doctor (one doctor per appointment),
 * set by the caller via `withApptDoctor` — not encoded per line. The data layer
 * clamps + validates ids against the clinic's own records.
 */
function parseProcedureSelections(formData: FormData): ProcedureSelection[] {
  return formData
    .getAll("procedure")
    .map(String)
    .map((raw) => {
      const [procedureId, qty, dtype, dval] = raw.split(":");
      const discountType = dtype === "percent" ? ("percent" as const) : ("amount" as const);
      // Same ceiling as the appointment-level discount. This field is hand-parsed out
      // of an encoded hidden input rather than going through zod, so the rule is
      // applied directly — and by CLAMPING rather than rejecting, because a malformed
      // value here means a bug in our own form, not something to show a user.
      const rawValue = Math.max(0, Number(dval) || 0);
      return {
        procedureId,
        quantity: Number(qty) || 1,
        discountType,
        discountValue:
          discountType === "percent" ? Math.min(rawValue, MAX_DISCOUNT_PERCENT) : rawValue,
      };
    })
    .filter((s) => s.procedureId);
}

/**
 * The services and one-off "other charges" on the bill. A service is
 * "<id>:<qty>:<price>"; a one-off charge is JSON {n, p, q}. Neither carries a
 * discount from the form — a listed service gets its clinic offer from
 * `applyClinicOffers`, as a procedure does — nor a doctor (no share) — `saveAppointmentProcedures` also
 * refuses a typed price on anything that is not really a service, and clamps.
 */
function parseServiceSelections(formData: FormData): ProcedureSelection[] {
  const listed = formData
    .getAll("service")
    .map(String)
    .map((raw) => {
      const [procedureId, qty, price] = raw.split(":");
      return {
        procedureId,
        quantity: Number(qty) || 1,
        unitPrice: Math.max(0, Number(price) || 0),
        discountType: "amount" as const,
        discountValue: 0,
      };
    })
    .filter((s) => s.procedureId);
  const oneOff = formData
    .getAll("charge")
    .map(String)
    .flatMap((raw): ProcedureSelection[] => {
      try {
        const c = JSON.parse(raw) as { n?: unknown; p?: unknown; q?: unknown };
        const name = typeof c.n === "string" ? c.n.trim() : "";
        if (!name) return [];
        return [
          {
            procedureId: null,
            name,
            unitPrice: Math.max(0, Number(c.p) || 0),
            quantity: Number(c.q) || 1,
            discountType: "amount",
            discountValue: 0,
          },
        ];
      } catch {
        // Our own form wrote this field; a malformed one is a bug, not user input.
        return [];
      }
    });
  return [...listed, ...oneOff];
}

/** Stamp every procedure line with the appointment's doctor (its performing doctor). */
function withApptDoctor(
  selections: ProcedureSelection[],
  doctorId: string | null,
): ProcedureSelection[] {
  return selections.map((s) => ({ ...s, doctorId }));
}

/** The "already booked that day" question for the form, or null when there is none. */
async function sameDayWarning(
  clinicId: string,
  patientId: string,
  when: Date,
  excludeAppointmentId?: string,
): Promise<ReceptionActionState["duplicate"] | null> {
  const sameDay = await findSameDayAppointments(clinicId, patientId, when, excludeAppointmentId);
  if (sameDay.length === 0) return null;
  return {
    date: when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    existing: sameDay.map(
      (a) =>
        `${formatTime12h(a.scheduledAt)}${a.doctorName ? ` with ${a.doctorName}` : ""}`,
    ),
  };
}

/** What the Invoices page's form takes with a new invoice. */
const invoicePaymentSchema = z.object({
  amount: z.coerce.number().int("Enter a whole amount.").min(0, "The amount can't be negative.").max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  /** Why — e.g. "part payment, balance next visit". Shown on the payment. */
  note: z.string().trim().max(500).optional(),
});

/** Schedules an appointment in the receptionist's clinic. */
export async function createAppointment(
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const { user, clinicId, home } = await requireAppointmentsAccess();
  if (!can(user, "appointments", "create")) {
    return { error: "You don't have permission to create appointments." };
  }

  // From the Invoices page: the visit is created WITH its invoice and the payment
  // taken (owner's call, 2026-10-12). Needs the billing grant as well.
  const asInvoice = formData.get("asInvoice") === "1";
  let invoicePayment: {
    amount: number;
    method: PaymentMethodCode;
    reference: string | null;
    note: string | null;
  } | null = null;
  // A plain booking may carry a payment too — an advance taken at booking, so the
  // desk does not schedule first and then open the appointment to record it (owner's
  // ask, 2026-10-13). Only when an amount was actually entered.
  const bookingPayment = !asInvoice && Number(formData.get("payAmount") || 0) > 0;
  if (asInvoice || bookingPayment) {
    if (!can(user, "billing", "create")) {
      return {
        error: asInvoice
          ? "You don't have permission to create invoices."
          : "You don't have permission to record payments.",
      };
    }
    const pay = invoicePaymentSchema.safeParse({
      amount: formData.get("payAmount") || "0",
      method: formData.get("payMethod") || "cash",
      reference: formData.get("payReference") || undefined,
      note: formData.get("payNote") || undefined,
    });
    if (!pay.success) return { error: zodErrorMessage(pay.error) };
    invoicePayment = {
      amount: pay.data.amount,
      method: pay.data.method,
      reference: pay.data.reference ?? null,
      note: pay.data.note ?? null,
    };
  }

  const parsed = createSchema.safeParse({
    patientId: formData.get("patientId"),
    doctorId: formData.get("doctorId"),
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes"),
    reason: formData.get("reason"),
    discountType: formData.get("discountType") ?? undefined,
    discountValue: formData.get("discountValue"),
    discountBorneBy: formData.get("discountBorneBy") ?? undefined,
    discountSplitType: formData.get("discountSplitType") ?? undefined,
    discountSplitValue: formData.get("discountSplitValue") ?? undefined,
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  const discountError = validateDiscount(
    parsed.data.discountType,
    parsed.data.discountValue,
  );
  if (discountError) return { error: discountError };

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "Invalid date & time." };

  // Booking-from-plan: the items' plan discount. When the discount on the form is
  // exactly that one, it is the plan's agreed discount and needs no approval (owner's
  // call, 2026-10-18); a discount the desk changed is an ordinary one.
  const planItemIds = formData
    .getAll("planItemId")
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const bookPlanItems = planItemIds.length > 0 && can(user, "plans", "edit");
  let discountFromPlan = false;
  if (bookPlanItems) {
    const fromPlan = await planDiscountForItems(clinicId, planItemIds);
    if (fromPlan && "error" in fromPlan) return { error: fromPlan.error };
    discountFromPlan = isPlanDiscount(fromPlan, {
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      borneBy: parsed.data.discountBorneBy,
      splitType: parsed.data.discountSplitType,
      splitValue: parsed.data.discountSplitValue,
    });
  }

  // Procedure-only visits don't charge the consultation fee (checkbox off → "0").
  const chargeConsultation = formData.get("chargeConsultation") !== "0";
  // Booked deliberately outside the doctor's windows (a 6pm procedure when they
  // consult 1–3pm). Relaxes the hours check only — see checkDoctorSlot.
  const requestedCustomTime = formData.get("customTime") === "1";
  // Set from the slot check below: ticking the box while picking a time that is
  // inside the doctor's hours anyway needs no override, so the flag is not stored.
  let customTime = false;

  // Tenant guards: patient (and doctor, if set) must belong to this clinic.
  const patient = await findClinicPatient(clinicId, parsed.data.patientId);
  if (!patient) return { error: "Patient not found." };

  // Same patient, same day: ask before booking a second visit (findSameDayAppointments
  // says why this warns rather than refuses). Checked before the slot check so the
  // question comes first; a confirmed resubmit skips it.
  if (formData.get("confirmDuplicate") !== "1") {
    const duplicate = await sameDayWarning(clinicId, parsed.data.patientId, when);
    if (duplicate) return { duplicate };
  }

  // Queue context comes from the slot check so we don't re-query the schedule.
  let queueAvailability: DayAvailability[] = [];
  let queueFlexible = false;
  // A visit carrying procedures may also use the doctor's procedure windows.
  // Clinic offers become each line's discount HERE, on the server (applyClinicOffers
  // says why the form never chooses one).
  const procedureSelections = await applyClinicOffers(
    clinicId,
    parseProcedureSelections(formData),
    localDateStr(when),
  );
  if (parsed.data.doctorId) {
    // Single source of truth for leave / working hours / daily cap.
    const check = await checkDoctorSlot(clinicId, parsed.data.doctorId, when, {
      hasProcedures: procedureSelections.length > 0,
      customTime: requestedCustomTime,
    });
    if (!check.ok) return { error: check.reason };
    queueAvailability = check.availability;
    queueFlexible = check.flexible;
    // Record the exception only when the time really is one. Storing it for a visit
    // that sits in normal hours is a lie the queue then acts on — it would file the
    // patient under "Outside visiting hours" while the doctor is in the room anyway.
    customTime = requestedCustomTime && !check.withinHours;
  }

  // Tag the appointment with the clinic's first enabled module (if any).
  const clinic = await getClinic(clinicId);

  // Assign the patient's queue token within the doctor's window session.
  const created = await withQueueNumber(
    {
      clinicId,
      doctorId: parsed.data.doctorId ?? null,
      when,
      availability: queueAvailability,
      flexible: queueFlexible,
    },
    (q) =>
      insertAppointment({
          clinicId,
          patientId: parsed.data.patientId,
          doctorId: parsed.data.doctorId ?? null,
          module: clinic?.modulesEnabled?.[0] ?? null,
          scheduledAt: when,
          durationMinutes: parsed.data.durationMinutes,
          reason: parsed.data.reason ?? null,
          discountType: parsed.data.discountType,
          discountValue: parsed.data.discountValue,
          discountBorneBy: parsed.data.discountBorneBy,
    discountSplitType: parsed.data.discountSplitType,
    discountSplitValue: parsed.data.discountSplitValue,
          discountFromPlan,
          chargeConsultation,
          customTime,
          // Who booked it — shown as "Created by" on the appointments list.
          createdBy: user.id,
          createdByName: displayStaffName(user.prefix, user.fullName, user.username),
          queueSession: q.queueSession,
          queueNumber: q.queueNumber,
        }),
  );

  // Attach the selected procedures (snapshotted prices) before notifying, so the
  // confirmation quotes the full total. Each line's performing doctor = the
  // appointment's doctor.
  await saveAppointmentProcedures(clinicId, created.id, [
    ...withApptDoctor(procedureSelections, parsed.data.doctorId ?? null),
    // Services take their clinic offer too (2026-10-18), the same way.
    ...(await applyClinicOffers(clinicId, parseServiceSelections(formData), localDateStr(when))),
  ]);

  // Booking-from-plan: schedule any selected treatment-plan items onto this
  // appointment — mints their appointment_procedures lines + marks them in progress.
  if (bookPlanItems) {
    await scheduleItemsOnAppointment(clinicId, created.id, planItemIds);
  }

  // Work out whether this discount needs anyone's approval (no-op unless a party
  // opted in) and set the appointment's discount status accordingly.
  await syncDiscountApprovals(clinicId, created.id);

  // A staff booking gets its invoice number now (owner's call): the number exists
  // from the start, for the slip and for search. WhatsApp requests get theirs when
  // the front desk confirms them (applyAppointmentStatus). Best-effort.
  await autoIssueInvoice(clinicId, created.id, {
    id: user.id,
    name: displayStaffName(user.prefix, user.fullName, user.username),
  });

  const actor = { id: user.id, name: displayStaffName(user.prefix, user.fullName, user.username) };
  if (asInvoice) {
    // An invoice is for a visit that is happening or has happened: complete it, so
    // it is in sales and doctor shares like any other completed visit. A future date
    // is billing in ADVANCE — the visit stays booked until it is actually completed.
    if (when.getTime() <= Date.now()) {
      await applyAppointmentStatus(clinicId, created.id, "completed", { notify: false });
    }
    if (invoicePayment && invoicePayment.amount > 0) {
      const paid = await recordPayment(clinicId, {
        patientId: parsed.data.patientId,
        appointmentId: created.id,
        amount: invoicePayment.amount,
        method: invoicePayment.method,
        reference: invoicePayment.reference,
        note: invoicePayment.note,
        actor,
      });
      // The visit and invoice exist either way; say so rather than lose the payment.
      if ("error" in paid) {
        report(new Error(paid.error), { op: "invoices.create.payment", clinicId, ids: { appointmentId: created.id } });
      }
    }
  } else {
    // Confirm to the patient over WhatsApp (doctor, hours, fee, time). Not for an
    // invoice: the patient is standing at the desk, not waiting for a booking.
    await notifyAppointmentBooked(clinicId, created.id);
    // An advance taken with the booking: recorded against the visit (its invoice
    // shows it), and — like taking money from the appointment page — it confirms a
    // scheduled appointment.
    if (invoicePayment && invoicePayment.amount > 0 && clinicHasFeature(clinic?.featuresEnabled, "sales")) {
      const paid = await recordPayment(clinicId, {
        patientId: parsed.data.patientId,
        appointmentId: created.id,
        amount: invoicePayment.amount,
        method: invoicePayment.method,
        reference: invoicePayment.reference,
        note: invoicePayment.note,
        actor,
      });
      if ("error" in paid) {
        report(new Error(paid.error), { op: "appointments.create.payment", clinicId, ids: { appointmentId: created.id } });
      } else {
        await confirmAppointmentOnPayment(clinicId, created.id);
        revalidateFinance();
      }
    }
  }

  await logActivity({
    action: "create",
    entity: "appointment",
    entityId: created.id,
    summary: `Scheduled an appointment for ${when.toLocaleString("en-GB")}`,
  });
  revalidatePath(home);
  // "Save & print thermal / A4 / A5" (owner's call, 2026-10-18): the size rides along
  // to the page the save lands on, which prints the invoice at it (core/ui/print-on-arrival).
  const then = String(formData.get("then") ?? "");
  const paper = /^print:(thermal|a4|a5)$/.exec(then)?.[1];
  // A one-time id rides with it, so the page prints this request once only.
  const printQuery = paper ? `&${AUTO_PRINT_PARAM}=${paper}&${AUTO_PRINT_ID_PARAM}=${randomUUID()}` : "";
  if (asInvoice) {
    revalidatePath("/clinic/invoices");
    revalidateFinance();
    // The older single "Save & print" still goes to the print screen.
    if (then === "print") {
      redirect(`/clinic/invoices/${created.id}/print?created=1`);
    }
    redirect(`/clinic/invoices/${created.id}?created=1${printQuery}`);
  }
  // Land on the NEW appointment's detail page — the payment panel + "Print bill /
  // receipt" are there, so staff can collect the fee and print right away instead of
  // going back to the list to find the appointment they just created.
  redirect(`${home}/${created.id}?created=1${printQuery}`);
}

const updateSchema = z.object({
  doctorId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().uuid().safeParse(v).success, {
      message: "Invalid doctor.",
    }),
  scheduledAt: z.string().min(1, "Pick a date & time."),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(30),
  reason: z.string().trim().optional(),
  discountType: z.enum(DISCOUNT_TYPE_CODES).default("amount"),
  discountValue: z.coerce.number().int().min(0, "Discount can't be negative.").default(0),
  discountBorneBy: z.enum(DISCOUNT_BEARER_CODES).default("clinic"),
  discountSplitType: z.enum(DISCOUNT_TYPE_CODES).default("percent"),
  discountSplitValue: z.coerce.number().int().min(0).default(0),
})
  .superRefine((v, ctx) => {
    // The bound depends on the discount TYPE, so it cannot live on the field itself:
    // a flat amount has no ceiling here (the bill clamps it), a percentage does.
    const e = discountError(v.discountType, v.discountValue);
    if (e) ctx.addIssue({ code: "custom", path: ["discountValue"], message: e });
    const se = discountError(v.discountSplitType, v.discountSplitValue);
    if (se) ctx.addIssue({ code: "custom", path: ["discountSplitValue"], message: se });
  });

/** Edits an existing appointment (doctor / date-time / duration / reason / discount). */
export async function updateAppointment(
  appointmentId: string,
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const { user, clinicId, home } = await requireAppointmentsAccess();
  if (!can(user, "appointments", "edit")) {
    return { error: "You don't have permission to edit appointments." };
  }

  const parsed = updateSchema.safeParse({
    doctorId: formData.get("doctorId"),
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes"),
    reason: formData.get("reason"),
    discountType: formData.get("discountType") ?? undefined,
    discountValue: formData.get("discountValue"),
    discountBorneBy: formData.get("discountBorneBy") ?? undefined,
    discountSplitType: formData.get("discountSplitType") ?? undefined,
    discountSplitValue: formData.get("discountSplitValue") ?? undefined,
  });
  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  const discountError = validateDiscount(
    parsed.data.discountType,
    parsed.data.discountValue,
  );
  if (discountError) return { error: discountError };

  const when = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "Invalid date & time." };

  const appt = await findAppointmentForEdit(clinicId, appointmentId);
  if (!appt) return { error: "Appointment not found." };

  // Moving the visit onto a day the patient is already booked: same question as
  // booking. Only when the DAY changes — a pair that already exists would otherwise
  // re-ask on every save of an unrelated field (a reason, a discount), which teaches
  // people to click through it.
  const sameDayAsBefore =
    localDateStr(appt.scheduledAt) === localDateStr(when);
  if (!sameDayAsBefore && formData.get("confirmDuplicate") !== "1") {
    const duplicate = await sameDayWarning(clinicId, appt.patientId, when, appointmentId);
    if (duplicate) return { duplicate };
  }

  let queueAvailability: DayAvailability[] = [];
  let queueFlexible = false;
  // The selection being SAVED decides which windows are acceptable — dropping the
  // last procedure narrows the visit back to consultation hours.
  // Lines the visit already had keep the discount they were booked with; a procedure
  // added now takes the clinic offer running on the visit date.
  const bookedLines = await getAppointmentProcedureItems(clinicId, appointmentId);
  const keepBooked = new Map(
    bookedLines
      .filter((l): l is typeof l & { procedureId: string } => Boolean(l.procedureId))
      .map((l) => [l.procedureId, { discountType: l.discountType, discountValue: l.discountValue }]),
  );
  const procedureSelections = await applyClinicOffers(
    clinicId,
    parseProcedureSelections(formData),
    localDateStr(when),
    keepBooked,
  );
  // Unticking this on an edit re-imposes the doctor's hours, so a visit moved back
  // into normal time stops being an exception. Same normalisation as create: the
  // flag survives only if the chosen time actually needs it.
  const requestedCustomTime = formData.get("customTime") === "1";
  let editCustomTime = false;
  if (parsed.data.doctorId) {
    // Same leave / hours / cap enforcement as booking (excludes this appt).
    const check = await checkDoctorSlot(clinicId, parsed.data.doctorId, when, {
      excludeAppointmentId: appointmentId,
      hasProcedures: procedureSelections.length > 0,
      customTime: requestedCustomTime,
    });
    if (!check.ok) return { error: check.reason };
    queueAvailability = check.availability;
    queueFlexible = check.flexible;
    editCustomTime = requestedCustomTime && !check.withinHours;
  }

  const baseSet = {
    doctorId: parsed.data.doctorId ?? null,
    scheduledAt: when,
    durationMinutes: parsed.data.durationMinutes,
    reason: parsed.data.reason ?? null,
    discountType: parsed.data.discountType,
    discountValue: parsed.data.discountValue,
    discountBorneBy: parsed.data.discountBorneBy,
    discountSplitType: parsed.data.discountSplitType,
    discountSplitValue: parsed.data.discountSplitValue,
    // A plan's discount stays the plan's only while nobody changes it; any edit to
    // the discount makes it an ordinary one, which follows the approval rules.
    discountFromPlan:
      appt.discountFromPlan &&
      appt.discountType === parsed.data.discountType &&
      appt.discountValue === parsed.data.discountValue &&
      appt.discountBorneBy === parsed.data.discountBorneBy &&
      appt.discountSplitType === parsed.data.discountSplitType &&
      appt.discountSplitValue === parsed.data.discountSplitValue,
    chargeConsultation: formData.get("chargeConsultation") !== "0",
    customTime: editCustomTime,
    reminderSentAt: null, // time may have changed → re-send the reminder
    editedAt: new Date(), // printed as "Edited:" on the invoice
    updatedAt: new Date(),
  };

  // Which queue session does the appointment belong to after this edit?
  const newSession = parsed.data.doctorId
    ? queueSessionKey(parsed.data.doctorId, when, queueAvailability, queueFlexible)
    : null;

  // A token is unique per DOCTOR-DAY (core/appointments/queue.ts), so moving between
  // windows WITHIN one day does not need a new one — the number is already unique
  // there, and the patient has been told it. Only a change of doctor or of day
  // requires re-issuing. Re-issuing on any session change (which was right while
  // numbering was per-session) now also makes the row count ITSELF in the day's max,
  // so simply switching AM to PM bumped #3 to #4.
  const withinSameDay = sameDoctorDay(newSession, appt.queueSession);

  if (newSession === appt.queueSession) {
    // Same window (or still no doctor) → nothing about the queue changes.
    await updateAppointmentFields(clinicId, appointmentId, baseSet);
  } else if (withinSameDay) {
    // Same doctor, same day, different window → move the card, keep the token.
    await updateAppointmentFields(clinicId, appointmentId, {
      ...baseSet,
      queueSession: newSession,
    });
  } else if (!parsed.data.doctorId) {
    // Moved to "Any doctor" → drop the token.
    await updateAppointmentFields(clinicId, appointmentId, {
      ...baseSet,
      queueSession: null,
      queueNumber: null,
    });
  } else {
    // Moved to a different doctor/window → issue a fresh token there.
    await withQueueNumber(
      {
        clinicId,
        doctorId: parsed.data.doctorId,
        when,
        availability: queueAvailability,
        flexible: queueFlexible,
      },
      (q) =>
        updateAppointmentFields(clinicId, appointmentId, {
          ...baseSet,
          queueSession: q.queueSession,
          queueNumber: q.queueNumber,
        }),
    );
  }

  // Replace the appointment's procedure line items with the current selection;
  // each line's performing doctor = the appointment's doctor.
  await saveAppointmentProcedures(clinicId, appointmentId, [
    ...withApptDoctor(procedureSelections, parsed.data.doctorId ?? null),
    // A service already on the visit keeps the discount it was booked with; one added
    // now takes the offer running on the visit date — the procedures' rule.
    ...(await applyClinicOffers(clinicId, parseServiceSelections(formData), localDateStr(when), keepBooked)),
  ]);

  // Recompute approvals AFTER the procedures/discount are saved (editing a discount
  // re-opens approval if it was decided), then re-snapshot the sale so the ledger
  // reflects the now-effective (possibly gated) discount.
  await syncDiscountApprovals(clinicId, appointmentId);

  // Re-derive the revenue so the edit (doctor/fee, procedures, discount) flows through
  // to the report. Not only for a completed visit: revenue follows the money
  // (ADR-035), so a deposit taken before the charges were entered becomes revenue as
  // they are added. The ledger decides for itself whether there is anything to book.
  await recordSaleForAppointment(clinicId, appointmentId);

  await logActivity({
    action: "update",
    entity: "appointment",
    entityId: appointmentId,
    summary: `Edited an appointment (now ${when.toLocaleString("en-GB")})`,
  });
  revalidatePath(home);
  revalidatePath(`/clinic/appointments/${appointmentId}`);
  revalidatePath(`/reception/appointments/${appointmentId}`);
  // The same visit is edited from its invoice page too, and the register lists its bill.
  revalidatePath(`/clinic/invoices/${appointmentId}`);
  revalidatePath("/clinic/invoices");
  revalidateFinance(); // an edit can change the bill/discount → revenue/shares
  // Stay on the edit form and show a success toast (no redirect).
  return { saved: true };
}

/** Trashes an appointment (step-up password). SOFT delete + voids its sale row;
 * recoverable from Trash. Clinic-scoped. */
export async function deleteAppointment(
  appointmentId: string,
  password: string,
): Promise<ReceptionActionState> {
  const { user, clinicId, home } = await requireAppointmentsAccess();
  if (!can(user, "appointments", "delete")) {
    return { error: "You don't have permission to delete appointments." };
  }

  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  const removed = await softDeleteAppointment(clinicId, appointmentId, user.id);
  // A trashed appointment must not count as realised revenue.
  if (removed) await voidSaleForAppointment(clinicId, appointmentId);

  await logActivity({
    action: "delete",
    entity: "appointment",
    entityId: appointmentId,
    summary: "Moved an appointment to Trash",
  });
  revalidatePath(home);
  redirect(home);
}

/**
 * Sets an appointment's status to any value (a dropdown, so it supports undo —
 * e.g. confirmed → scheduled). Patient notices fire only on an actual TRANSITION
 * into a status (guarded by the prior status), never on re-selecting the same one.
 */
export async function setAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<void> {
  const { user, clinicId, home } = await requireAppointmentsAccess();
  // Changing status is an edit; silently no-op when not permitted (the UI hides
  // the control too).
  if (!can(user, "appointments", "edit")) return;
  if (!APPOINTMENT_STATUSES.includes(status)) return;

  const changed = await applyAppointmentStatus(clinicId, appointmentId, status);
  if (!changed) return;

  revalidatePath(home);
  revalidatePath(`/clinic/appointments/${appointmentId}`);
  revalidatePath(`/reception/appointments/${appointmentId}`);
  // The same visit is edited from its invoice page too, and the register lists its bill.
  revalidatePath(`/clinic/invoices/${appointmentId}`);
  revalidatePath("/clinic/invoices");
  revalidateFinance(); // completing/uncompleting changes realised revenue + shares
}

/** Patient typeahead for the new-appointment picker (clinic-scoped). */
export async function searchClinicPatients(
  query: string,
): Promise<{ id: string; fullName: string; phone: string | null; mrn: string | null }[]> {
  const { clinicId } = await requireAppointmentsAccess();
  const q = query.trim();

  // Same picker shape the booking panel uses (core/patients/list).
  const rows = await (q ? searchPatientsForPicker(clinicId, q) : listRecentPatients(clinicId, 20));

  return rows.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    mrn: p.mrnLabel,
  }));
}

export type DoctorDaySlots = {
  available: boolean;
  onLeave: boolean;
  flexible: boolean;
  /** The doctor's working windows on the selected date (empty when flexible/off). */
  windows: { start: string; end: string; kind: WindowKind }[];
  limit: number;
  booked: number;
  remaining: number | null; // null = unlimited
  hours: string | null;
};

/**
 * Live capacity for a doctor on a given date — powers the "appointments left"
 * hint in the scheduling form. `dateStr` is the datetime-local value. Returns a
 * safe "unavailable" shape for an unknown/foreign doctor. Clinic-scoped.
 */
export async function doctorDayAvailability(
  doctorId: string,
  dateStr: string,
): Promise<DoctorDaySlots> {
  const { clinicId } = await requireAppointmentsAccess();
  const when = new Date(dateStr);

  const doc = await getDoctorScheduleFields(clinicId, doctorId);

  if (!doc || Number.isNaN(when.getTime())) {
    return {
      available: false,
      onLeave: false,
      flexible: false,
      windows: [],
      limit: 0,
      booked: 0,
      remaining: 0,
      hours: null,
    };
  }

  // Leave overrides everything: a doctor on leave is unavailable that day.
  const onLeave = await doctorOnLeave(clinicId, doctorId, localDateStr(when));

  const avail = (doc.availability ?? []) as DayAvailability[];
  const flexible = doc.flexibleHours;
  // Every window the day offers, tagged — the form shows procedure slots too,
  // since a visit with procedures may be booked into either kind.
  const windows = flexible
    ? []
    : windowsForWeekday(avail, when.getDay()).map((w) => ({
        start: w.start,
        end: w.end,
        kind: windowKind(w),
      }));
  // Flexible doctors are bookable any time; otherwise the day must have windows.
  const availableByHours = flexible ? true : windows.length > 0;
  const available = !onLeave && availableByHours;
  const hours = flexible
    ? "Any time"
    : windows.length
      ? windows.map((w) => `${w.start}–${w.end}`).join(", ")
      : null;

  const booked = await countDoctorDay(clinicId, doctorId, when);
  const remaining =
    doc.dailyLimit > 0 ? Math.max(0, doc.dailyLimit - booked) : null;

  return { available, onLeave, flexible, windows, limit: doc.dailyLimit, booked, remaining, hours };
}

/**
 * Sets a doctor's daily appointment limit — usable by the receptionist AND the
 * clinic admin (both manage capacity). Clinic-scoped and doctor-only.
 */
export async function setDoctorDailyLimit(
  doctorId: string,
  _prev: ReceptionActionState,
  formData: FormData,
): Promise<ReceptionActionState> {
  const { user, clinicId, home } = await requireAppointmentsAccess();
  // Daily caps are a capacity/admin function — doctors manage only their leave.
  if (user.role === "doctor") {
    return { error: "Doctors can't set daily appointment limits." };
  }
  if (!can(user, "schedule", "edit")) {
    return { error: "You don't have permission to change doctor scheduling." };
  }

  const parsed = z.coerce
    .number({ message: "Enter a number." })
    .int("Whole number only.")
    .min(0, "Cannot be negative.")
    .max(500, "That's too large.")
    .safeParse(formData.get("dailyLimit"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid limit." };
  }

  const limitSaved = await setDoctorDailyLimitRecord(clinicId, doctorId, parsed.data);
  if (!limitSaved) return { error: "Doctor not found." };

  await logActivity({
    action: "update",
    entity: "staff",
    entityId: doctorId,
    summary: `Set a doctor's daily appointment limit to ${parsed.data}`,
  });
  revalidatePath(home);
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/schedule");
  revalidatePath("/clinic/staff");
  return { saved: true };
}

export type LeaveActionState = {
  error?: string;
  saved?: boolean;
  cancelled?: number;
};

const leaveSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an end date."),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "End date can't be before the start date.",
    path: ["endDate"],
  });

/**
 * Marks a doctor on leave/vacation for a date range — usable by the receptionist
 * AND the clinic admin. Any active (scheduled/confirmed) appointments for that
 * doctor within the range are CANCELLED, since the doctor won't be in. Returns
 * how many were cancelled. Clinic-scoped and doctor-only.
 */
export async function addDoctorLeave(
  doctorId: string,
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const { user, clinicId, home } = await requireAppointmentsAccess();
  if (!can(user, "leave", "create")) {
    return { error: "You don't have permission to set doctor leave." };
  }
  // A doctor may only add their OWN leave, never another doctor's.
  if (user.role === "doctor" && doctorId !== user.id) {
    return { error: "You can only add your own leave." };
  }

  const parsed = leaveSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: (formData.get("reason") as string) || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid dates." };
  }

  const doc = await findClinicDoctor(clinicId, doctorId);
  if (!doc) return { error: "Doctor not found." };

  const cancelledIds = await addDoctorLeaveRecord(clinicId, doctorId, {
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    reason: parsed.data.reason ?? null,
  });

  // Notify affected patients (doctor + time) after the cancellations commit.
  if (cancelledIds.length > 0) {
    await notifyAppointmentsCancelled(clinicId, cancelledIds);
  }

  await logActivity({
    action: "create",
    entity: "leave",
    entityId: doctorId,
    summary: `Set doctor leave ${parsed.data.startDate}→${parsed.data.endDate}${cancelledIds.length ? ` (${cancelledIds.length} appt(s) cancelled)` : ""}`,
  });
  revalidatePath(home);
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/schedule");
  revalidatePath("/clinic/staff", "layout");
  revalidatePath("/clinic"); // doctor manages own leave from the dashboard
  return { saved: true, cancelled: cancelledIds.length };
}

/**
 * Edits an existing leave entry's dates / reason. Same rules as adding: clinic-
 * scoped, a doctor may only edit their OWN leave, and any active appointments that
 * now fall inside the (possibly widened) range are cancelled. Appointments freed
 * by narrowing the range are NOT auto-restored (mirrors removeDoctorLeave).
 */
export async function updateDoctorLeave(
  leaveId: string,
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const { user, clinicId } = await requireAppointmentsAccess();
  if (!can(user, "leave", "edit")) {
    return { error: "You don't have permission to edit doctor leave." };
  }

  const parsed = leaveSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: (formData.get("reason") as string) || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid dates." };
  }

  // Load the entry (clinic-scoped) so we know whose leave it is.
  const lv = await findLeave(clinicId, leaveId);
  if (!lv) return { error: "Leave not found." };
  // A doctor may only edit their OWN leave.
  if (user.role === "doctor" && lv.doctorId !== user.id) {
    return { error: "You can only edit your own leave." };
  }

  const doctorId = lv.doctorId;
  const cancelledIds = await updateDoctorLeaveRange(clinicId, leaveId, doctorId, {
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate,
    reason: parsed.data.reason ?? null,
  });

  if (cancelledIds.length > 0) {
    await notifyAppointmentsCancelled(clinicId, cancelledIds);
  }

  await logActivity({
    action: "update",
    entity: "leave",
    entityId: leaveId,
    summary: `Edited doctor leave to ${parsed.data.startDate}→${parsed.data.endDate}${cancelledIds.length ? ` (${cancelledIds.length} appt(s) cancelled)` : ""}`,
  });
  revalidatePath("/clinic/appointments");
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/schedule");
  revalidatePath("/clinic/staff", "layout");
  revalidatePath("/clinic"); // doctor manages own leave from the dashboard
  return { saved: true, cancelled: cancelledIds.length };
}

/**
 * Removes a leave entry (does not restore already-cancelled appointments).
 * Step-up: the signed-in user must re-enter their own password (like every other
 * delete in the app). Returns an error to keep the confirm dialog open.
 */
export async function removeDoctorLeave(
  leaveId: string,
  password: string,
): Promise<{ error?: string } | void> {
  const { user, clinicId, home } = await requireAppointmentsAccess();
  if (!can(user, "leave", "delete")) redirect(home);
  // A doctor may only remove their OWN leave.
  if (user.role === "doctor") {
    const lv = await findLeave(clinicId, leaveId);
    if (!lv || lv.doctorId !== user.id) redirect(home);
  }

  if (!(await verifyCurrentUserPassword(password))) {
    return { error: "Incorrect password." };
  }

  await softDeleteLeave(clinicId, leaveId, user.id);

  await logActivity({
    action: "delete",
    entity: "leave",
    entityId: leaveId,
    summary: "Moved a doctor leave entry to Trash",
  });
  revalidatePath(home);
  revalidatePath("/reception/doctors");
  revalidatePath("/clinic/schedule");
  revalidatePath("/clinic/staff", "layout");
  revalidatePath("/clinic"); // doctor manages own leave from the dashboard
}
