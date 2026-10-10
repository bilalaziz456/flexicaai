/**
 * CLINIC OFFERS — a discount the clinic sets on a procedure for a range of visit
 * dates, applied by the server at booking as the line's discount, and never sent for
 * approval. A patient discount (on the appointment) still is.
 *
 * Covers: the date window (pure), what `applyClinicOffers` puts on a line — including
 * that a discount sent by the browser is DISCARDED and that an edit keeps what was
 * booked — and that approval engages for a patient discount but not for an offer.
 *
 * Seeds its own clinic and removes it afterwards.
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-procedure-offers.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments, clinics, patients, procedures, users } from "@/core/db/schema";
import { offerForVisit, offerStatus, type ProcedureOffer } from "@/core/appointments/procedure-offer";
import {
  applyClinicOffers,
  getAppointmentProcedureItems,
  saveAppointmentProcedures,
  setProcedureOffer,
} from "@/core/appointments/procedures";
import { syncDiscountApprovals } from "@/core/appointments/approvals";
import { getAppointmentShareContext, shareInputFromContext } from "@/core/appointments/share-context";
import { computeShare } from "@/core/appointments/shares";
import { computeBill } from "@/core/appointments/fee";

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

const tag = `po${Date.now()}`;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return ymd(d);
};

function windowChecks() {
  console.log("\nThe date window (pure):");
  const o = (startsOn: string | null, endsOn: string | null, value = 20): ProcedureOffer => ({
    type: "percent",
    value,
    startsOn,
    endsOn,
  });
  ok("inside start–end is active", offerStatus(o("2026-10-15", "2026-10-31"), "2026-10-20") === "active");
  ok("the start and end days themselves count", offerStatus(o("2026-10-15", "2026-10-31"), "2026-10-15") === "active" && offerStatus(o("2026-10-15", "2026-10-31"), "2026-10-31") === "active");
  ok("before the start is scheduled, not applied", offerStatus(o("2026-10-15", "2026-10-31"), "2026-10-14") === "scheduled" && offerForVisit(o("2026-10-15", "2026-10-31"), "2026-10-14") === null);
  ok("after the end has ended, not applied", offerStatus(o("2026-10-15", "2026-10-31"), "2026-11-01") === "ended" && offerForVisit(o("2026-10-15", "2026-10-31"), "2026-11-01") === null);
  ok('"No end date" runs indefinitely', offerStatus(o("2026-10-15", null), "2030-01-01") === "active");
  ok("no start date means it already applies", offerStatus(o(null, "2026-10-31"), "2026-01-01") === "active");
  ok("value 0 is no offer at all", offerStatus(o(null, null, 0), "2026-10-20") === "none");
  ok("a percent above 100 is clamped when applied", offerForVisit(o(null, null, 150), "2026-10-20")?.value === 100);
}

async function main() {
  windowChecks();
  await unscoped("behaviour test — seeds its own clinic", async () => {
    const [clinic] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: ["dental"], featuresEnabled: ["sales"], discountNeedsApproval: true })
      .returning({ id: clinics.id });
    try {
      const [doctor] = await db
        .insert(users)
        .values({ clinicId: clinic.id, username: `${tag}doc`, passwordHash: "x", role: "doctor", fullName: "Offer Doc", flexibleHours: true, consultationFee: 1000, procedureSharePct: 10 })
        .returning({ id: users.id });
      const [patient] = await db
        .insert(patients)
        .values({ clinicId: clinic.id, fullName: "PO Patient", phone: "+923001230000" })
        .returning({ id: patients.id });
      const [a, b] = await db
        .insert(procedures)
        .values([
          { clinicId: clinic.id, name: "Scaling", price: 3000 },
          { clinicId: clinic.id, name: "Filling", price: 4000 },
        ])
        .returning({ id: procedures.id });

      console.log("\nSetting offers:");
      const visit = day(3);
      ok("one call sets the offer on many procedures", (await setProcedureOffer(clinic.id, [a.id, b.id], { type: "percent", value: 20, startsOn: day(0), endsOn: day(10) })) === 2);
      ok("removing it is one call too", (await setProcedureOffer(clinic.id, [b.id], null)) === 1);
      ok("another clinic's id is ignored", (await setProcedureOffer(clinic.id, ["00000000-0000-0000-0000-000000000000"], null)) === 0);

      console.log("\nWhat booking puts on each line:");
      // The browser asks for Rs 999 off Filling — a line discount needs no approval,
      // so honouring it would be a way round the patient-discount approval.
      const sent = [
        { procedureId: a.id, quantity: 1, discountType: "amount" as const, discountValue: 0 },
        { procedureId: b.id, quantity: 1, discountType: "amount" as const, discountValue: 999 },
      ];
      const applied = await applyClinicOffers(clinic.id, sent, visit);
      ok("the procedure with an offer gets it", applied[0].discountType === "percent" && applied[0].discountValue === 20);
      ok("a discount sent by the browser is discarded", applied[1].discountValue === 0, JSON.stringify(applied[1]));
      const after = await applyClinicOffers(clinic.id, sent, day(20));
      ok("a visit after the offer ends gets none", after[0].discountValue === 0);
      const kept = await applyClinicOffers(clinic.id, sent, day(20), new Map([[a.id, { discountType: "percent", discountValue: 20 }]]));
      ok("an EDIT keeps what the line was booked with, even after the offer ended", kept[0].discountType === "percent" && kept[0].discountValue === 20);

      console.log("\nApproval (this clinic requires it for discounts):");
      const [appt] = await db
        .insert(appointments)
        .values({ clinicId: clinic.id, patientId: patient.id, doctorId: doctor.id, scheduledAt: new Date(`${visit}T10:00:00`), status: "scheduled" })
        .returning({ id: appointments.id });
      await saveAppointmentProcedures(clinic.id, appt.id, applied.map((s) => ({ ...s, doctorId: doctor.id })));
      const items = await getAppointmentProcedureItems(clinic.id, appt.id);
      const bill = computeBill(1000, items, "amount", 0);
      ok("the saved bill carries the offer: 1000 + 3000×0.8 + 4000 = 7400", bill.net === 7400, String(bill.net));
      ok("an offer alone does NOT need approval", (await syncDiscountApprovals(clinic.id, appt.id)) === "none");
      const ctx = await getAppointmentShareContext(clinic.id, appt.id);
      ok("…because the patient discount is 0", ctx.patientDiscount === 0 && ctx.grossTotal - ctx.netRequested === 0);

      console.log("\nDoctor share — an offer is shared in proportion:");
      // Scaling 3000 under 20% → 2400; Filling 4000. Doctor takes 10% of procedures.
      ok("a line's share base is its price AFTER the offer", ctx.lines.find((l) => l.label === "Scaling")?.gross === 2400);
      ok("the doctor's 10% is of 2400 + 4000 = 640", computeShare(shareInputFromContext(ctx)).doctors[doctor.id] === 640);

      // The owner's example: a Rs 1,000 procedure, a 10% offer, a 10% doctor share.
      const [ex] = await db.insert(procedures).values({ clinicId: clinic.id, name: "Example", price: 1000 }).returning({ id: procedures.id });
      await setProcedureOffer(clinic.id, [ex.id], { type: "percent", value: 10, startsOn: day(0), endsOn: null });
      const [exAppt] = await db
        .insert(appointments)
        .values({ clinicId: clinic.id, patientId: patient.id, doctorId: doctor.id, scheduledAt: new Date(`${visit}T15:00:00`), status: "scheduled", chargeConsultation: false })
        .returning({ id: appointments.id });
      await saveAppointmentProcedures(
        clinic.id,
        exAppt.id,
        (await applyClinicOffers(clinic.id, [{ procedureId: ex.id, quantity: 1, discountType: "amount", discountValue: 0 }], visit)).map((s) => ({ ...s, doctorId: doctor.id })),
      );
      const exSplit = computeShare(shareInputFromContext(await getAppointmentShareContext(clinic.id, exAppt.id)));
      ok("Rs 1,000 with a 10% offer and a 10% share: the doctor earns Rs 90", exSplit.doctors[doctor.id] === 90, JSON.stringify(exSplit));
      ok("…and the clinic Rs 810", exSplit.clinic === 810);
      // "Discount borne by" is about the PATIENT discount; it must not move the offer.
      await db.update(appointments).set({ discountBorneBy: "doctor" }).where(eq(appointments.id, exAppt.id));
      const exDoctorBorne = computeShare(shareInputFromContext(await getAppointmentShareContext(clinic.id, exAppt.id)));
      ok('…still Rs 90 when "Discount borne by" says Doctor', exDoctorBorne.doctors[doctor.id] === 90, JSON.stringify(exDoctorBorne));

      await db.update(appointments).set({ discountType: "amount", discountValue: 500 }).where(eq(appointments.id, appt.id));
      ok("a PATIENT discount still needs approval", (await syncDiscountApprovals(clinic.id, appt.id)) === "pending");
      ok("…and it is measured on its own (500), not with the offer", (await getAppointmentShareContext(clinic.id, appt.id)).patientDiscount === 500);
    } finally {
      await db.execute(sql`delete from notifications where clinic_id = ${clinic.id}::uuid`);
      await db.execute(sql`delete from appointment_discount_approvals where clinic_id = ${clinic.id}::uuid`);
      await db.execute(sql`delete from appointment_procedures where clinic_id = ${clinic.id}::uuid`);
      await db.delete(appointments).where(eq(appointments.clinicId, clinic.id));
      await db.delete(procedures).where(eq(procedures.clinicId, clinic.id));
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
