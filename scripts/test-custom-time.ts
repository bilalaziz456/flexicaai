/**
 * Per-appointment CUSTOM TIME (migration `0086`) + procedure names in the patient's
 * WhatsApp messages.
 *
 * A clinic books a procedure at 6pm for a doctor who consults 1–3pm. `customTime`
 * relaxes the WORKING-HOURS rule for that one appointment — and only that rule: leave
 * and the daily cap still apply, because agreeing to come in at 6pm is not the same as
 * being available during your holiday or past your own cap. That distinction is the
 * whole design, so each half is asserted separately.
 *
 * Also pins that `insertAppointment` really persists the flag: it takes
 * `Record<string, unknown>` and casts, so a misspelled key would be dropped in silence
 * with tsc perfectly happy.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, doctorLeaves, patients, users } from "@/core/db/schema";
import { checkDoctorSlot } from "@/core/appointments/availability";
import {
  appointmentProcedureNamesSql,
  appointmentProceduresGrossSql,
} from "@/core/appointments/procedures";

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

const tag = `ct${Date.now()}`;

async function main() {
  await unscoped("schema/behaviour test — seeds its own clinic", async () => {
    console.log("\nCustom time + procedure names in WhatsApp\n");

    const [clinic] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: ["dental"], featuresEnabled: ["sales"] })
      .returning({ id: clinics.id });

    // Consults 13:00–15:00 on EVERY weekday, so the test never depends on what day it
    // runs. 18:00 is outside all of them.
    const availability = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      start: "13:00",
      end: "15:00",
      kind: "consultation" as const,
    }));
    const [doctor] = await db
      .insert(users)
      .values({
        clinicId: clinic.id,
        username: `${tag}doc`,
        passwordHash: "x",
        role: "doctor",
        fullName: "Custom Time",
        availability,
        consultationFee: 1000,
      })
      .returning({ id: users.id });

    const [patient] = await db
      .insert(patients)
      .values({ clinicId: clinic.id, fullName: "CT Patient", phone: "03001234567" })
      .returning({ id: patients.id });

    // Tomorrow at 18:00 and at 14:00, local wall clock.
    const base = new Date();
    base.setDate(base.getDate() + 1);
    const at = (h: number) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0, 0);
    const evening = at(18);
    const inHours = at(14);

    // ── The rule it relaxes ────────────────────────────────────────────────
    const plain = await checkDoctorSlot(clinic.id, doctor.id, evening);
    ok("6pm is refused without the override", !plain.ok, plain.ok ? "" : plain.reason);
    ok(
      "…and the refusal names the real hours, so staff know what to do",
      !plain.ok && plain.reason.includes("13:00"),
      plain.ok ? "" : plain.reason,
    );

    const custom = await checkDoctorSlot(clinic.id, doctor.id, evening, { customTime: true });
    ok("6pm is accepted WITH the override", custom.ok, custom.ok ? "" : custom.reason);

    const normal = await checkDoctorSlot(clinic.id, doctor.id, inHours);
    ok("a normal in-hours time still works untouched", normal.ok, normal.ok ? "" : normal.reason);

    // ── `withinHours`: was the override actually NEEDED? ───────────────────
    // The reported bug: staff tick "Custom time" and then pick a time that is inside
    // the doctor's hours anyway. Storing the flag there is a lie the queue acts on —
    // it files the patient under "Outside visiting hours" while the doctor is in the
    // room at that time regardless. So the write paths keep the flag only when
    // `withinHours` is false.
    ok(
      "an in-hours time reports withinHours, so the flag is dropped",
      normal.ok && normal.withinHours === true,
    );
    ok(
      "…even when the override was requested for it",
      custom.ok && (await checkDoctorSlot(clinic.id, doctor.id, inHours, { customTime: true })).ok,
    );
    const inHoursWithFlag = await checkDoctorSlot(clinic.id, doctor.id, inHours, { customTime: true });
    ok(
      "requesting the override at an in-hours time still reports withinHours",
      inHoursWithFlag.ok && inHoursWithFlag.withinHours === true,
    );
    ok(
      "a genuinely outside time reports NOT withinHours, so the flag is kept",
      custom.ok && custom.withinHours === false,
    );

    // ── The rules it must NOT relax ────────────────────────────────────────
    const dayStr = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    await db.insert(doctorLeaves).values({
      clinicId: clinic.id,
      doctorId: doctor.id,
      startDate: dayStr,
      endDate: dayStr,
    });
    const onLeave = await checkDoctorSlot(clinic.id, doctor.id, evening, { customTime: true });
    ok("LEAVE still blocks a custom time", !onLeave.ok, onLeave.ok ? "" : onLeave.reason);
    await db.delete(doctorLeaves).where(eq(doctorLeaves.clinicId, clinic.id));

    // Daily cap of 1, one appointment already booked → the second is refused even
    // with a custom time.
    await db.update(users).set({ dailyAppointmentLimit: 1 }).where(eq(users.id, doctor.id));
    await db.insert(appointments).values({
      clinicId: clinic.id,
      patientId: patient.id,
      doctorId: doctor.id,
      scheduledAt: inHours,
    });
    const capped = await checkDoctorSlot(clinic.id, doctor.id, evening, { customTime: true });
    ok("the DAILY CAP still blocks a custom time", !capped.ok, capped.ok ? "" : capped.reason);
    await db.update(users).set({ dailyAppointmentLimit: 0 }).where(eq(users.id, doctor.id));

    // ── The flag is actually stored ────────────────────────────────────────
    const [saved] = await db
      .insert(appointments)
      .values({
        clinicId: clinic.id,
        patientId: patient.id,
        doctorId: doctor.id,
        scheduledAt: evening,
        customTime: true,
      })
      .returning({ id: appointments.id, customTime: appointments.customTime });
    ok("customTime persists on the row", saved.customTime === true);

    const [dflt] = await db
      .insert(appointments)
      .values({ clinicId: clinic.id, patientId: patient.id, doctorId: doctor.id, scheduledAt: inHours })
      .returning({ customTime: appointments.customTime });
    ok("it defaults to false, so existing rows are unaffected", dflt.customTime === false);

    // ── Procedure names for the WhatsApp messages ──────────────────────────
    const names = async (apptId: string) => {
      const [row] = await db
        .select({ names: appointmentProcedureNamesSql() })
        .from(appointments)
        .where(and(eq(appointments.clinicId, clinic.id), eq(appointments.id, apptId)));
      return row?.names ?? null;
    };

    ok("no procedures → NULL, so the message stays as it was", (await names(saved.id)) === null);

    await db.execute(sql`
      insert into appointment_procedures (clinic_id, appointment_id, name, unit_price, quantity)
      values (${clinic.id}::uuid, ${saved.id}::uuid, 'Root canal', 12000, 1),
             (${clinic.id}::uuid, ${saved.id}::uuid, 'Filling', 3000, 2)
    `);
    const listed = await names(saved.id);
    ok("names are listed for the patient", listed === "Filling ×2, Root canal", `got ${listed}`);
    ok("a quantity above 1 is shown, not hidden", (listed ?? "").includes("×2"));

    // The snapshot is what the patient was told — renaming the catalog entry later
    // must not rewrite it. (The line stores its own `name`, so prove it stays put.)
    await db.execute(sql`update procedures set name = 'Renamed' where clinic_id = ${clinic.id}::uuid`);
    ok("names come from the LINE snapshot, not the catalog", (await names(saved.id)) === listed);

    // REGRESSION: the correlated helpers must work whether or not the outer query
    // joins. Drizzle only qualifies a column when it judges the query needs it, so a
    // single-table `from(appointments)` used to emit `where "appointment_id" = "id"`,
    // binding `id` to appointment_procedures and silently returning 0 for the money
    // helpers. Every production caller happens to join, which is why it never showed.
    const [noJoin] = await db
      .select({ gross: appointmentProceduresGrossSql(), names: appointmentProcedureNamesSql() })
      .from(appointments)
      .where(eq(appointments.id, saved.id));
    const [withJoin] = await db
      .select({ gross: appointmentProceduresGrossSql(), names: appointmentProcedureNamesSql() })
      .from(appointments)
      .innerJoin(patients, eq(appointments.patientId, patients.id))
      .where(eq(appointments.id, saved.id));
    ok("the gross helper is right WITHOUT a join", noJoin.gross === 18000, `got ${noJoin.gross}`);
    ok("…and identical WITH one", withJoin.gross === noJoin.gross);
    ok("same for the names helper", noJoin.names === withJoin.names && noJoin.names === listed);

    // Cleanup: this clinic is disposable, and nothing else references it.
    await db.execute(sql`delete from appointment_procedures where clinic_id = ${clinic.id}::uuid`);
    await db.delete(appointments).where(eq(appointments.clinicId, clinic.id));
    await db.delete(patients).where(eq(patients.clinicId, clinic.id));
    await db.delete(users).where(eq(users.clinicId, clinic.id));
    await db.delete(clinics).where(eq(clinics.id, clinic.id));

    console.log(`\n${pass} passed, ${fail} failed\n`);
  });
  process.exit(fail === 0 ? 0 : 1);
}

main();
