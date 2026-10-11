/**
 * "Created by" on the appointments list (owner's ask, 2026-10-12): a staff booking
 * shows who made it, a patient's WhatsApp self-booking shows WhatsApp, and the filter
 * narrows to either. Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-appointment-created-by.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patients, users } from "@/core/db/schema";
import {
  buildAppointmentConds,
  listAppointmentCreators,
  listClinicAppointments,
} from "@/core/appointments/list-query";
import { parseListFilters } from "@/core/appointments/list-filters";

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

async function main() {
  await unscoped("behaviour test — seeds its own clinic", async () => {
    const tag = `acb${Date.now()}`;
    const [clinic] = await db.insert(clinics).values({ name: tag, modulesEnabled: ["dental"] }).returning({ id: clinics.id });
    const clinicId = clinic.id;
    try {
      const mk = (u: string, name: string) =>
        db
          .insert(users)
          .values({ clinicId, username: `${tag}${u}`, passwordHash: "x", role: "receptionist", fullName: name })
          .returning({ id: users.id })
          .then((r) => r[0].id);
      const ayesha = await mk("a", "Ayesha");
      const bilal = await mk("b", "Bilal");
      const [patient] = await db.insert(patients).values({ clinicId, fullName: "CB Patient", phone: "+923001230009" }).returning({ id: patients.id });
      const when = new Date();
      when.setHours(10, 0, 0, 0);
      const book = (values: Partial<typeof appointments.$inferInsert>) =>
        db
          .insert(appointments)
          .values({ clinicId, patientId: patient.id, scheduledAt: when, status: "scheduled", ...values })
          .returning({ id: appointments.id })
          .then((r) => r[0].id);
      const byAyesha = await book({ createdBy: ayesha, createdByName: "Ayesha" });
      const byBilal = await book({ createdBy: bilal, createdByName: "Bilal" });
      const viaWa = await book({ source: "whatsapp" });

      const list = async (createdBy?: string) => {
        const start = new Date(when);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        const r = await listClinicAppointments(
          clinicId,
          buildAppointmentConds({ start, endExclusive: end, createdBy }),
          { offset: 0, limit: 50 },
        );
        return r.rows;
      };

      console.log("\nThe rows say who:");
      const all = await list();
      const row = (id: string) => all.find((r) => r.id === id);
      ok("a staff booking carries the staff member's name", row(byAyesha)?.createdByName === "Ayesha");
      ok("a WhatsApp self-booking is marked whatsapp, with no staff name", row(viaWa)?.source === "whatsapp" && row(viaWa)?.createdByName === null);

      console.log("\nThe filter:");
      ok("Anyone lists all three", all.length === 3, String(all.length));
      const wa = await list("whatsapp");
      ok("WhatsApp lists only the self-booking", wa.length === 1 && wa[0].id === viaWa);
      const ay = await list(ayesha);
      ok("Ayesha lists only hers", ay.length === 1 && ay[0].id === byAyesha);
      const bi = await list(bilal);
      ok("Bilal lists only his", bi.length === 1 && bi[0].id === byBilal);

      console.log("\nThe dropdown and the URL:");
      const creators = await listAppointmentCreators(clinicId);
      ok("the options are the people who booked, by name", creators.map((c) => c.name).join(",") === "Ayesha,Bilal", JSON.stringify(creators));
      ok('"whatsapp" is accepted from the URL', parseListFilters({ createdBy: "whatsapp" }).createdBy === "whatsapp");
      ok("a staff id is accepted from the URL", parseListFilters({ createdBy: ayesha }).createdBy === ayesha);
      ok("anything else is dropped", parseListFilters({ createdBy: "drop table" }).createdBy === "");
    } finally {
      await db.execute(sql`delete from activity_logs where clinic_id = ${clinicId}::uuid`);
      await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
      await db.delete(patients).where(eq(patients.clinicId, clinicId));
      await db.delete(users).where(eq(users.clinicId, clinicId));
      await db.delete(clinics).where(eq(clinics.id, clinicId));
    }
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
