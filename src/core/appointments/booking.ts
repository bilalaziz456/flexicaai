import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, clinics, users } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { checkDoctorSlot } from "@/core/appointments/availability";
import { findSameDayAppointments } from "@/core/appointments/same-day";
import { withQueueNumber } from "@/core/appointments/queue";
import { parseWhen } from "@/core/appointments/parse-when";
import { report } from "@/core/observability";
import { logPatientAction } from "@/core/audit/log";
import {
  describeAvailability,
  type DayAvailability,
} from "@/core/lib/availability";

/**
 * True when the inbound text looks like a NEW booking request (not a reschedule —
 * the webhook checks reschedule intent first). Excludes "cancel" so a cancel
 * message doesn't get treated as a booking.
 */
export function isBookingIntent(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (/\bcancel\b/.test(t)) return false;
  return (
    /\b(book|booking|schedule)\b/.test(t) ||
    (/\b(appointment|appt)\b/.test(t) &&
      /\b(want|need|make|get|new|another)\b/.test(t))
  );
}

type DocRow = { id: string; name: string; availability: DayAvailability[] };

async function clinicDoctors(clinicId: string): Promise<DocRow[]> {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      availability: users.availability,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.role, "doctor"), eq(users.isActive, true)),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    name: r.fullName ?? r.username,
    availability: (r.availability ?? []) as DayAvailability[],
  }));
}

/** Doctors whose name appears in the message (match on any name word ≥3 chars). */
function matchDoctor(docs: DocRow[], text: string): DocRow[] {
  const t = text.toLowerCase();
  return docs.filter((d) =>
    d.name
      .toLowerCase()
      .split(/\s+/)
      .some((part) => part.length >= 3 && t.includes(part)),
  );
}

/** "Mon 13 Jul, 15:00" — the requested slot for the acknowledgement. */
function fmtWhen(d: Date): string {
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Dr Khan (Mon 09:00–17:00, …); Dr Ali (Any time)" — names + visiting hours. */
function listDoctors(docs: DocRow[]): string {
  return docs
    .map((d) => `${d.name} (${describeAvailability(d.availability)})`)
    .join("; ");
}

const reply = (
  clinicId: string,
  patientId: string,
  phone: string,
  message: string,
) =>
  sendWhatsAppToPatient({
    clinicId,
    patientId,
    phone,
    campaignName: serverEnv.AISENSY_BOOKING_REPLY_CAMPAIGN,
    templateParams: [message],
    body: message,
  });

export type BookingOutcome = {
  handled: boolean;
  booked: boolean;
  /** The created appointment's id (set when booked) — for a deep-linked notification. */
  appointmentId?: string | null;
};

/**
 * Handles a patient's "book …" WhatsApp message — CORE, clinic-scoped. Resolves
 * the doctor (named, or the clinic's only doctor, else asks which), parses the
 * date/time, validates it against the doctor's visiting hours / leave / daily cap
 * (`checkDoctorSlot`), creates the appointment (status "scheduled"), and confirms
 * — or replies with the doctor's hours / the reason it couldn't. Best-effort;
 * never throws. Only registered patients (matched by phone) can self-book.
 */
export async function handleBookingReply(args: {
  clinicId: string;
  patientId: string;
  phone: string;
  text: string;
}): Promise<BookingOutcome> {
  const { clinicId, patientId, phone, text } = args;
  if (!isBookingIntent(text)) return { handled: false, booked: false };

  try {
    const now = new Date();
    const docs = await clinicDoctors(clinicId);
    if (docs.length === 0) {
      await reply(
        clinicId,
        patientId,
        phone,
        "Sorry, online booking isn't available right now. Please contact the clinic.",
      );
      return { handled: true, booked: false };
    }

    // Resolve the doctor.
    let doctor: DocRow;
    const named = matchDoctor(docs, text);
    if (named.length === 1) {
      doctor = named[0];
    } else if (named.length > 1) {
      await reply(
        clinicId,
        patientId,
        phone,
        `Which doctor? We have: ${listDoctors(named)}. Reply e.g. "book with ${named[0].name} monday 3pm".`,
      );
      return { handled: true, booked: false };
    } else if (docs.length === 1) {
      doctor = docs[0];
    } else {
      await reply(
        clinicId,
        patientId,
        phone,
        `Which doctor would you like? We have: ${listDoctors(docs)}. Reply e.g. "book with ${docs[0].name} monday 3pm".`,
      );
      return { handled: true, booked: false };
    }

    // A new booking needs both a date and a time.
    const parsed = parseWhen(text, now);
    if (!parsed.date || !parsed.time) {
      await reply(
        clinicId,
        patientId,
        phone,
        `${doctor.name} is available ${describeAvailability(doctor.availability)}. Reply with a date & time to book, e.g. "book with ${doctor.name} monday 3pm".`,
      );
      return { handled: true, booked: false };
    }

    let when = new Date(
      parsed.date.y,
      parsed.date.m - 1,
      parsed.date.d,
      parsed.time.h,
      parsed.time.min,
      0,
      0,
    );
    if (!parsed.explicitYear && when.getTime() < now.getTime()) {
      when = new Date(when);
      when.setFullYear(when.getFullYear() + 1);
    }
    if (when.getTime() < now.getTime()) {
      await reply(
        clinicId,
        patientId,
        phone,
        "That time is in the past. Please reply with a future date & time.",
      );
      return { handled: true, booked: false };
    }

    // Same day as one of the patient's live appointments: ask before taking a second
    // request, as the front-desk form does. A patient cannot click a dialog, so the
    // confirmation is a WORD — resending with "another" books it. Stateless on
    // purpose: nothing has to remember that the question was asked, and the word is
    // one `isBookingIntent` already recognises. Most of what this catches is the same
    // message sent twice; a genuine second visit costs the patient one more message.
    if (!/\banother\b/i.test(text)) {
      const sameDay = await findSameDayAppointments(clinicId, patientId, when);
      if (sameDay.length > 0) {
        const existing = sameDay
          .map(
            (a) =>
              `${a.scheduledAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}${a.doctorName ? ` with ${a.doctorName}` : ""}`,
          )
          .join(", ");
        const day = when.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
        // The example is the bare date and time — what `parseWhen` reads most simply.
        const exampleDay = when.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        const exampleTime = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        await reply(
          clinicId,
          patientId,
          phone,
          `You already have an appointment on ${day} at ${existing}. To book another one that day as well, send your message again with the word "another", e.g. "book another with ${doctor.name} ${exampleDay} ${exampleTime}".`,
        );
        return { handled: true, booked: false };
      }
    }

    // Enforce the doctor's visiting hours / leave / daily cap.
    const check = await checkDoctorSlot(clinicId, doctor.id, when);
    if (!check.ok) {
      await reply(
        clinicId,
        patientId,
        phone,
        `Couldn't book: ${check.reason} Please reply with another date & time.`,
      );
      return { handled: true, booked: false };
    }

    const [clinic] = await db
      .select({ modulesEnabled: clinics.modulesEnabled })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    // Assign the patient's queue token in the doctor's window session.
    const [created] = await withQueueNumber(
      {
        clinicId,
        doctorId: doctor.id,
        when,
        availability: check.availability,
        flexible: check.flexible,
      },
      (q) =>
        db
          .insert(appointments)
          .values({
            clinicId,
            patientId,
            doctorId: doctor.id,
            module: clinic?.modulesEnabled?.[0] ?? null,
            scheduledAt: when,
            status: "scheduled",
            source: "whatsapp",
            queueSession: q.queueSession,
            queueNumber: q.queueNumber,
          })
          .returning({ id: appointments.id, queueNumber: appointments.queueNumber }),
    );

    // A WhatsApp booking is a REQUEST: acknowledge it as pending (with the token
    // so the patient knows their number). The clinic confirms it in-panel, and
    // that confirm sends the full confirmation message (slot, time, doctor, fee,
    // token) — see setAppointmentStatus.
    const tokenStr =
      created?.queueNumber != null ? ` Your token number is #${created.queueNumber}.` : "";
    await reply(
      clinicId,
      patientId,
      phone,
      `Thanks! Your booking request for ${doctor.name} on ${fmtWhen(when)} has been received.${tokenStr} The clinic will confirm it shortly and you'll get a confirmation message.`,
    );
    // Audited as a "create": the patient made a real appointment row, pending the
    // clinic's confirmation. §10 — best-effort, and after the reply.
    await logPatientAction({
      clinicId,
      patientId,
      action: "create",
      entity: "appointment",
      entityId: created?.id ?? null,
      summary: `Patient requested an appointment with ${doctor.name} on ${fmtWhen(when)} over WhatsApp`,
    });
    return { handled: true, booked: true, appointmentId: created?.id ?? null };
  } catch (e) {
    // An inbound webhook must never fail on a booking attempt — but to the patient
    // a silent failure looks like the clinic ignored their message.
    report(e, { op: "appointments.handleBookingReply", clinicId, ids: { patientId } });
    return { handled: true, booked: false };
  }
}
