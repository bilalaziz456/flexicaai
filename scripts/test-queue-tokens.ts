/**
 * Queue tokens are unique per DOCTOR per DAY, and a session's card says what it is.
 *
 * A session (`${doctorId}:${date}:${window}`) is a DISPLAY grouping — one card per
 * visiting window. The TOKEN is different in kind: it is what a patient is told and
 * quotes at the desk, so two people seeing the same doctor on the same day must never
 * hold the same number. Numbering per session gave a doctor with a morning and an
 * evening clinic two "#1"s, and a custom-time visit — which falls outside every window
 * into the `:day` bucket — a third.
 *
 * Also pins the label: `:day` means "flexible/unscheduled" for a doctor with no windows
 * and "outside the hours" for one who has them, and those must not read alike.
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import { getDayQueue, queueSessionKey, sameDoctorDay, withQueueNumber } from "@/core/appointments/queue";

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

const tag = `qt${Date.now()}`;

async function main() {
  await unscoped("queue test — seeds its own clinic", async () => {
    console.log("\nQueue tokens per doctor-day + honest session labels\n");

    const [clinic] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: ["dental"] })
      .returning({ id: clinics.id });

    // A morning AND an evening clinic every weekday — two real windows, so the test
    // never depends on which day it runs.
    const availability = Array.from({ length: 7 }, (_, weekday) => [
      { weekday, start: "09:00", end: "12:00", kind: "consultation" as const },
      { weekday, start: "16:00", end: "19:00", kind: "consultation" as const },
    ]).flat();

    const mk = async (name: string, av: typeof availability) =>
      (
        await db
          .insert(users)
          .values({
            clinicId: clinic.id,
            username: `${tag}${name}`,
            passwordHash: "x",
            role: "doctor",
            fullName: name,
            availability: av,
          })
          .returning({ id: users.id })
      )[0];

    const windowed = await mk("Windowed", availability);
    const unscheduled = await mk("Unscheduled", []);

    const [patient] = await db
      .insert(patients)
      .values({ clinicId: clinic.id, fullName: "QT Patient" })
      .returning({ id: patients.id });

    const day = new Date();
    day.setDate(day.getDate() + 1);
    const at = (h: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0, 0, 0);

    /** Book through the real assignment path and return the token it handed out. */
    const book = async (doctorId: string, hour: number, av: typeof availability) =>
      withQueueNumber(
        { clinicId: clinic.id, doctorId, when: at(hour), availability: av, flexible: false },
        async (q) => {
          await db.insert(appointments).values({
            clinicId: clinic.id,
            patientId: patient.id,
            doctorId,
            scheduledAt: at(hour),
            queueSession: q.queueSession,
            queueNumber: q.queueNumber,
          });
          return q;
        },
      );

    // Morning window, evening window, then a CUSTOM time outside both.
    const a = await book(windowed.id, 10, availability); // w0
    const b = await book(windowed.id, 17, availability); // w1
    const c = await book(windowed.id, 21, availability); // :day — the custom-time case

    ok("first patient of the day is #1", a.queueNumber === 1, `got ${a.queueNumber}`);
    ok(
      "the evening clinic CONTINUES the numbering, it does not restart",
      b.queueNumber === 2,
      `got ${b.queueNumber}`,
    );
    ok(
      "a custom-time visit continues it too",
      c.queueNumber === 3,
      `got ${c.queueNumber}`,
    );
    ok(
      "…while still living in its own session, so the cards stay split",
      a.queueSession !== b.queueSession && b.queueSession !== c.queueSession,
    );
    ok(
      "the custom-time visit lands in the day bucket",
      (c.queueSession ?? "").endsWith(":day"),
      c.queueSession ?? "null",
    );

    const numbers = [a.queueNumber, b.queueNumber, c.queueNumber];
    ok("no two patients of one doctor share a token that day", new Set(numbers).size === 3);

    // A DIFFERENT doctor numbers independently — the scope is doctor-day, not clinic-day.
    const other = await book(unscheduled.id, 10, []);
    ok("another doctor starts at #1 again", other.queueNumber === 1, `got ${other.queueNumber}`);

    // ── Moving a visit must not renumber it ───────────────────────────────
    // Editing 09:00 → 17:00 changes the WINDOW (w0 → w1) but not the doctor-day, so
    // the token stays. Re-issuing on any session change made the row count itself in
    // the day's max, which is why switching AM to PM turned #3 into #4.
    const morning = queueSessionKey(windowed.id, at(10), availability, false);
    const evening = queueSessionKey(windowed.id, at(17), availability, false);
    const outside = queueSessionKey(windowed.id, at(21), availability, false);
    const otherDay = queueSessionKey(windowed.id, new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 10), availability, false);

    ok("AM → PM is the same doctor-day, so the token is kept", sameDoctorDay(morning, evening));
    ok("…so is a move to a custom time", sameDoctorDay(morning, outside));
    ok("a move to ANOTHER day is not, so it is re-issued", !sameDoctorDay(morning, otherDay));
    ok(
      "a move to another DOCTOR is not either",
      !sameDoctorDay(morning, queueSessionKey(unscheduled.id, at(10), [], false)),
    );
    ok("an appointment with no session never matches", !sameDoctorDay(morning, null));

    // ── Labels ────────────────────────────────────────────────────────────
    const sessions = await getDayQueue(clinic.id, at(12));
    const labels = Object.fromEntries(sessions.map((s) => [s.key.split(":").pop(), s]));

    ok("the morning card shows its hours", labels.w0?.windowLabel === "9:00 AM – 12:00 PM", labels.w0?.windowLabel);
    ok("the evening card shows its hours", labels.w1?.windowLabel === "4:00 PM – 7:00 PM", labels.w1?.windowLabel);

    // Two `:day` sessions exist — one per doctor — and they must NOT read alike.
    const dayCards = sessions.filter((s) => s.key.endsWith(":day"));
    const windowedDay = dayCards.find((s) => s.doctorId === windowed.id);
    const unscheduledDay = dayCards.find((s) => s.doctorId === unscheduled.id);
    ok(
      "a doctor WITH hours labels the overflow 'Outside visiting hours'",
      windowedDay?.windowLabel === "Outside visiting hours",
      windowedDay?.windowLabel,
    );
    ok(
      "a doctor with NO hours still reads 'Any time'",
      unscheduledDay?.windowLabel === "Any time",
      unscheduledDay?.windowLabel,
    );

    // The window regex is easy to break silently — a lost backslash in `/^w(\d+)$/`
    // matches nothing, so EVERY card would fall through to the no-window label and
    // the hours above would vanish. The two hour assertions are that guard; this one
    // states it outright.
    ok(
      "window sessions never fall through to the no-window label",
      labels.w0?.windowLabel !== "Outside visiting hours" &&
        labels.w0?.windowLabel !== "Any time",
    );

    await db.delete(appointments).where(eq(appointments.clinicId, clinic.id));
    await db.delete(patients).where(eq(patients.clinicId, clinic.id));
    await db.delete(users).where(eq(users.clinicId, clinic.id));
    await db.delete(clinics).where(eq(clinics.id, clinic.id));

    console.log(`\n${pass} passed, ${fail} failed\n`);
  });
  process.exit(fail === 0 ? 0 : 1);
}

main();
