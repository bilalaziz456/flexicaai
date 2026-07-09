import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, clinics, users } from "@/core/db/schema";
import { serverEnv } from "@/core/lib/env";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";
import { checkDoctorSlot } from "@/core/appointments/availability";
import { parseWhen } from "@/core/appointments/parse-when";
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

export type BookingOutcome = { handled: boolean; booked: boolean };

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

    await db.insert(appointments).values({
      clinicId,
      patientId,
      doctorId: doctor.id,
      module: clinic?.modulesEnabled?.[0] ?? null,
      scheduledAt: when,
      status: "scheduled",
      source: "whatsapp",
    });

    // A WhatsApp booking is a REQUEST: acknowledge it as pending. The clinic
    // confirms it in-panel, and that confirm sends the full confirmation message
    // (slot, time, doctor, fee) — see setAppointmentStatus.
    await reply(
      clinicId,
      patientId,
      phone,
      `Thanks! Your booking request for ${doctor.name} on ${fmtWhen(when)} has been received. The clinic will confirm it shortly and you'll get a confirmation message.`,
    );
    return { handled: true, booked: true };
  } catch {
    return { handled: true, booked: false };
  }
}
