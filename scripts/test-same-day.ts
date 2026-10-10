/**
 * SAME-DAY DUPLICATES — the question asked before a patient gets a second live
 * appointment on one day, on every path that can create one: the lookup itself, and
 * WhatsApp booking and reschedule, whose "confirmation" is a word in the message
 * because a patient cannot click a dialog. (The desk's dialog is the form's half of
 * the same rule and is exercised by hand.)
 *
 * Seeds its own clinic and removes it afterwards. WhatsApp is not configured in a
 * test environment, so replies are recorded rather than sent — which is what lets
 * this read them back.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-same-day.ts`
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patients, users, whatsappMessages } from "@/core/db/schema";
import { findSameDayAppointments } from "@/core/appointments/same-day";
import { handleBookingReply } from "@/core/appointments/booking";
import { handleRescheduleReply } from "@/core/appointments/reschedule";
import { formatWhen } from "@/core/appointments/parse-when";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const tag = `sd${Date.now()}`;

/** Local wall-clock time `days` from today at `h:00`. */
function at(days: number, h: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
}

async function main() {
  await unscoped("behaviour test — seeds its own clinic", async () => {
    const [clinic] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: ["dental"] })
      .returning({ id: clinics.id });
    try {
      // Flexible hours, no cap: nothing but the same-day rule can refuse a slot here.
      const [doctor] = await db
        .insert(users)
        .values({
          clinicId: clinic.id,
          username: `${tag}doc`,
          passwordHash: "x",
          role: "doctor",
          fullName: "Same Day",
          flexibleHours: true,
        })
        .returning({ id: users.id });
      const phone = "+923001234999";
      const [patient] = await db
        .insert(patients)
        .values({ clinicId: clinic.id, fullName: "SD Patient", phone })
        .returning({ id: patients.id });

      const D1 = at(3, 10);
      const D2 = at(5, 11);
      const D3 = at(7, 12);
      const seed = (when: Date, status: "scheduled" | "cancelled") =>
        db
          .insert(appointments)
          .values({ clinicId: clinic.id, patientId: patient.id, doctorId: doctor.id, scheduledAt: when, status })
          .returning({ id: appointments.id })
          .then((r) => r[0].id);
      const a = await seed(D1, "scheduled");
      const b = await seed(D2, "scheduled");
      await seed(D3, "cancelled");

      const count = async () =>
        (
          await db
            .select({ n: sql<number>`count(*)::int` })
            .from(appointments)
            .where(and(eq(appointments.clinicId, clinic.id), eq(appointments.patientId, patient.id)))
        )[0].n;
      const lastReply = async () =>
        (
          await db
            .select({ body: whatsappMessages.body })
            .from(whatsappMessages)
            .where(eq(whatsappMessages.clinicId, clinic.id))
            .orderBy(desc(whatsappMessages.createdAt))
            .limit(1)
        )[0]?.body ?? "";
      const scheduledAt = async (id: string) =>
        (
          await db
            .select({ at: appointments.scheduledAt })
            .from(appointments)
            .where(and(eq(appointments.clinicId, clinic.id), eq(appointments.id, id)))
        )[0].at.getTime();

      console.log("\nThe lookup:");
      ok("finds the live appointment on that day", (await findSameDayAppointments(clinic.id, patient.id, at(5, 16))).length === 1);
      ok("…but not the appointment being moved", (await findSameDayAppointments(clinic.id, patient.id, at(5, 16), b)).length === 0);
      ok("a CANCELLED visit does not count", (await findSameDayAppointments(clinic.id, patient.id, at(7, 9))).length === 0);
      ok("an empty day finds nothing", (await findSameDayAppointments(clinic.id, patient.id, at(9, 9))).length === 0);

      console.log("\nWhatsApp booking:");
      const args = { clinicId: clinic.id, patientId: patient.id, phone };
      const before = await count();
      const asked = await handleBookingReply({ ...args, text: `book ${formatWhen(at(5, 15))}` });
      ok("a request for an occupied day is NOT booked", !asked.booked && asked.handled);
      ok("…and creates nothing", (await count()) === before);
      const askReply = await lastReply();
      ok('…and the reply asks for "another"', askReply.includes('"another"'), askReply);
      const confirmed = await handleBookingReply({ ...args, text: `book another ${formatWhen(at(5, 15))}` });
      ok('resending with "another" books it', confirmed.booked && (await count()) === before + 1);
      const free = await handleBookingReply({ ...args, text: `book ${formatWhen(at(9, 15))}` });
      ok("a free day books with no question", free.booked);

      console.log("\nWhatsApp reschedule (moves the NEXT upcoming visit, i.e. D1):");
      const toOccupied = await handleRescheduleReply({ ...args, text: `reschedule ${formatWhen(at(5, 10))}` });
      ok("moving onto an occupied day is NOT done", !toOccupied.rescheduled && toOccupied.handled);
      ok("…the visit stays where it was", (await scheduledAt(a)) === D1.getTime());
      const rsReply = await lastReply();
      ok('…and the reply asks for "anyway"', rsReply.includes('"anyway"'), rsReply);
      const moved = await handleRescheduleReply({ ...args, text: `reschedule ${formatWhen(at(5, 10))} anyway` });
      ok('resending with "anyway" moves it', moved.rescheduled && (await scheduledAt(a)) === at(5, 10).getTime());
      // Now on D2 beside two others. Moving it WITHIN the day must not ask again —
      // the pair already exists, and re-asking on every change teaches people to
      // click through the question.
      const sameDay = await handleRescheduleReply({ ...args, text: `reschedule ${formatWhen(at(5, 17))}` });
      ok("a move WITHIN the same day does not ask", sameDay.rescheduled && (await scheduledAt(a)) === at(5, 17).getTime());
    } finally {
      await db.execute(sql`delete from activity_logs where clinic_id = ${clinic.id}::uuid`);
      await db.delete(whatsappMessages).where(eq(whatsappMessages.clinicId, clinic.id));
      await db.delete(appointments).where(eq(appointments.clinicId, clinic.id));
      await db.delete(patients).where(eq(patients.clinicId, clinic.id));
      await db.delete(users).where(eq(users.clinicId, clinic.id));
      await db.delete(clinics).where(eq(clinics.id, clinic.id));
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
