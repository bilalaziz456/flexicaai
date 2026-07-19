/**
 * Seed a realistic DEMO clinic ("Clinic002") for end-to-end testing across
 * past / present / future. Idempotent: wipes any prior Clinic002 first.
 *
 * Run (from repo root):
 *   npx tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/seed-demo.ts
 *
 * Login after seeding:  clinic002 / clinic002  (clinic admin)
 *
 * Why it imports core code: revenue lives in DERIVED ledgers (sales / sale_shares /
 * discount_settlements) that the app computes at completion. We insert base rows,
 * recompute `amount_collected`, then call the app's own `backfillClinicSales` so
 * every report (Sales, Shares, P&L, Receivables, dashboard) reconciles exactly.
 */
import bcrypt from "bcryptjs";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import {
  clinics,
  users,
  patients,
  procedures as proceduresTbl,
  appointments,
  appointmentProcedures,
  patientPayments,
  recalls,
  expenses,
  expenseCategories,
  whatsappMessages,
  invoices,
  doctorPayouts,
} from "@/core/db/schema";
import { backfillClinicSales } from "@/core/sales/ledger";
import { queueSessionKey } from "@/core/appointments/queue";
import type { DayAvailability } from "@/core/lib/availability";

// ─── deterministic PRNG so re-runs produce the same world ───────────────────
let _s = 20260719;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const chance = (p: number) => rnd() < p;

const NOW = new Date(); // app "today" — everything is relative to this
const dayMs = 86400000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * dayMs);
const at = (d: Date, h: number, m: number) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const CLINIC_NAME = "Clinic002";
const FIRST = ["Ayesha", "Bilal", "Sara", "Usman", "Zainab", "Hamza", "Fatima", "Ali", "Maryam", "Ahmed", "Hina", "Omar", "Sana", "Imran", "Nadia", "Kashif", "Rabia", "Faisal", "Amna", "Tariq", "Sadia", "Junaid", "Lubna", "Waqar"];
const LAST = ["Khan", "Ahmed", "Malik", "Tariq", "Ali", "Sheikh", "Butt", "Qureshi", "Raza", "Hussain", "Iqbal", "Chaudhry", "Farooq", "Siddiqui"];
const fullName = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => `+92300${int(1000000, 9999999)}`;

async function wipePrior() {
  const rows = await db.execute<{ id: string }>(sql`select id from clinics where name = ${CLINIC_NAME}`);
  for (const r of rows.rows as { id: string }[]) {
    // users don't cascade from clinic (set null) — delete their sessions + rows first.
    await db.execute(sql`delete from sessions where user_id in (select id from users where clinic_id = ${r.id})`);
    await db.execute(sql`delete from users where clinic_id = ${r.id}`);
    // everything else cascades from clinics on delete; expense_categories too.
    await db.execute(sql`delete from clinics where id = ${r.id}`);
  }
}

/** Assign appointment # (queue token) to every doctor appointment, mirroring the
 *  app's queueSessionKey grouping + FCFS numbering. Clears first to avoid the
 *  (clinic, session, number) unique-index colliding during row-by-row updates. */
async function assignQueueTokens(clinicId: string) {
  const rows = await db
    .select({
      id: appointments.id,
      scheduledAt: appointments.scheduledAt,
      doctorId: appointments.doctorId,
      availability: users.availability,
      flexible: users.flexibleHours,
    })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.doctorId))
    .where(and(eq(appointments.clinicId, clinicId), isNotNull(appointments.doctorId)));

  await db
    .update(appointments)
    .set({ queueSession: null, queueNumber: null })
    .where(and(eq(appointments.clinicId, clinicId), isNotNull(appointments.doctorId)));

  const bySession = new Map<string, { id: string; scheduledAt: Date }[]>();
  for (const r of rows) {
    const session = queueSessionKey(r.doctorId!, r.scheduledAt, (r.availability ?? []) as DayAvailability[], !!r.flexible);
    if (!bySession.has(session)) bySession.set(session, []);
    bySession.get(session)!.push({ id: r.id, scheduledAt: r.scheduledAt });
  }
  for (const [session, items] of bySession) {
    items.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.id.localeCompare(b.id));
    let n = 1;
    for (const it of items) {
      await db.update(appointments).set({ queueSession: session, queueNumber: n }).where(eq(appointments.id, it.id));
      n++;
    }
  }
}

async function main() {
  console.log("Wiping any prior demo clinic…");
  await wipePrior();

  // ── clinic ────────────────────────────────────────────────────────────────
  const [clinic] = await db
    .insert(clinics)
    .values({
      name: CLINIC_NAME,
      modulesEnabled: ["dental"],
      featuresEnabled: ["sales", "finance"],
      avgVisitValue: 3000,
      invoicePrefix: "INV-",
      nextInvoiceNo: 1,
    })
    .returning({ id: clinics.id });
  const clinicId = clinic.id;
  console.log("Clinic002 →", clinicId);

  // ── users: admin + doctors ─────────────────────────────────────────────────
  const hash = await bcrypt.hash("clinic002", 12);
  await db.insert(users).values({
    clinicId,
    username: "clinic002",
    passwordHash: hash,
    role: "clinic_admin",
    prefix: "Dr",
    fullName: "Demo Admin",
    isActive: true,
  });

  const weekHours = [
    { weekday: 1, start: "09:00", end: "17:00" },
    { weekday: 2, start: "09:00", end: "17:00" },
    { weekday: 3, start: "09:00", end: "17:00" },
    { weekday: 4, start: "09:00", end: "17:00" },
    { weekday: 5, start: "09:00", end: "17:00" },
    { weekday: 6, start: "10:00", end: "14:00" },
  ];
  const docDefs = [
    { name: "Adeel Rana", fee: 3000, cShare: 40, pShare: 30, flex: false },
    { name: "Bushra Nadeem", fee: 2500, cShare: 50, pShare: 40, flex: false },
    { name: "Danish Waheed", fee: 4000, cShare: 35, pShare: 25, flex: false },
    { name: "Erum Shah", fee: 2000, cShare: 0, pShare: 0, flex: true },
    { name: "Faisal Karim", fee: 3500, cShare: 0, pShare: 0, flex: false },
  ];
  const docHash = await bcrypt.hash("doctor123", 12);
  const doctors: { id: string; name: string; fee: number }[] = [];
  for (let i = 0; i < docDefs.length; i++) {
    const d = docDefs[i];
    const [row] = await db
      .insert(users)
      .values({
        clinicId,
        username: `c002_doc${i + 1}`,
        passwordHash: docHash,
        role: "doctor",
        prefix: "Dr",
        fullName: d.name,
        isActive: true,
        availability: d.flex ? [] : weekHours,
        flexibleHours: d.flex,
        consultationFee: d.fee,
        consultationSharePct: d.cShare,
        procedureSharePct: d.pShare,
      })
      .returning({ id: users.id });
    doctors.push({ id: row.id, name: d.name, fee: d.fee });
  }
  console.log(`${doctors.length} doctors, 1 admin`);

  // ── procedures (dental) ─────────────────────────────────────────────────────
  const procDefs = [
    ["Composite filling", 4000],
    ["Dental crown", 18000],
    ["Denture (per arch)", 25000],
    ["Root canal treatment (RCT)", 15000],
    ["Scaling & polishing (cleaning)", 3000],
    ["Surgical extraction", 8000],
    ["Tooth extraction", 2500],
    ["Teeth whitening", 12000],
  ] as const;
  const procs: { id: string; name: string; price: number }[] = [];
  for (const [name, price] of procDefs) {
    const [row] = await db
      .insert(proceduresTbl)
      .values({ clinicId, name, price, module: "dental", isActive: true })
      .returning({ id: proceduresTbl.id });
    procs.push({ id: row.id, name, price });
  }

  // ── patients ────────────────────────────────────────────────────────────────
  const NUM_PATIENTS = 40;
  const patientIds: { id: string; name: string; phone: string }[] = [];
  for (let i = 0; i < NUM_PATIENTS; i++) {
    const name = fullName();
    const ph = phone();
    const age = int(6, 70);
    const dob = ymd(new Date(NOW.getFullYear() - age, int(0, 11), int(1, 28)));
    const [row] = await db
      .insert(patients)
      .values({
        clinicId,
        fullName: name,
        phone: ph,
        email: chance(0.4) ? `${name.split(" ")[0].toLowerCase()}${i}@example.com` : null,
        dateOfBirth: dob,
        gender: pick(["male", "female"]),
        reference: chance(0.5) ? pick(["Walk-in", "Referral: Dr. Adeel", "Facebook ad", "Google", "Existing patient"]) : null,
        dataConsent: chance(0.7),
      })
      .returning({ id: patients.id });
    patientIds.push({ id: row.id, name, phone: ph });
  }
  console.log(`${patientIds.length} patients`);

  const actor = { id: null as string | null, name: "Demo Admin" };
  const methods = ["cash", "bank", "cheque", "other"];

  // ── appointments across the timeline ────────────────────────────────────────
  // Past: 6 months → yesterday (mostly completed). Today: a live queue.
  // Future: tomorrow → 5 weeks (scheduled/confirmed).
  type Appt = { id: string; patientId: string; doctorId: string; scheduledAt: Date; status: string; bill: number };
  const made: Appt[] = [];
  let completedWithBill = 0;

  async function makeAppointment(scheduledAt: Date, status: string, opts: { queueSession?: string; queueNumber?: number } = {}) {
    const patient = pick(patientIds);
    const doctor = pick(doctors);
    const chargeConsult = chance(0.85);
    // discount on ~15% of visits; borne by clinic/doctor/split
    const hasDiscount = chance(0.15);
    const discountType = hasDiscount ? pick(["amount", "percent"]) : "amount";
    const discountValue = hasDiscount ? (discountType === "percent" ? int(5, 20) : int(200, 1000)) : 0;
    const borneBy = hasDiscount ? pick(["clinic", "doctor", "split"]) : "clinic";

    const [row] = await db
      .insert(appointments)
      .values({
        clinicId,
        patientId: patient.id,
        doctorId: doctor.id,
        module: "dental",
        scheduledAt,
        durationMinutes: 30,
        status: status as never,
        reason: chance(0.6) ? pick(["Cleaning", "Toothache", "Follow-up", "Consultation", "Filling", "Check-up"]) : null,
        discountType,
        discountValue,
        discountBorneBy: borneBy,
        chargeConsultation: chargeConsult,
        source: chance(0.2) ? "whatsapp" : "staff",
        reminderSentAt: null,
        queueSession: opts.queueSession ?? null,
        queueNumber: opts.queueNumber ?? null,
      })
      .returning({ id: appointments.id });
    const apptId = row.id;

    // Procedures only on completed / today visits (a bill to pay).
    let procTotal = 0;
    if (status === "completed" || status === "confirmed" || status === "scheduled") {
      const n = chance(0.55) ? int(1, 3) : 0;
      const chosen = new Set<number>();
      for (let k = 0; k < n; k++) {
        let idx = int(0, procs.length - 1);
        if (chosen.has(idx)) continue;
        chosen.add(idx);
        const p = procs[idx];
        const qty = chance(0.85) ? 1 : int(1, 2);
        await db.insert(appointmentProcedures).values({
          clinicId,
          appointmentId: apptId,
          procedureId: p.id,
          doctorId: doctor.id,
          name: p.name,
          unitPrice: p.price,
          quantity: qty,
        });
        procTotal += p.price * qty;
      }
    }
    const gross = (chargeConsult ? doctor.fee : 0) + procTotal;
    const disc = discountValue > 0 ? (discountType === "percent" ? Math.round((gross * discountValue) / 100) : discountValue) : 0;
    const bill = Math.max(0, gross - disc);

    made.push({ id: apptId, patientId: patient.id, doctorId: doctor.id, scheduledAt, status, bill });

    // Payments only for completed visits with a bill.
    if (status === "completed" && bill > 0) {
      completedWithBill++;
      const roll = rnd();
      let collected = 0;
      if (roll < 0.55) collected = bill; // fully paid
      else if (roll < 0.85) collected = Math.round(bill * (0.3 + rnd() * 0.5)); // partial
      else collected = 0; // unpaid → receivable
      if (collected > 0) {
        // 1 or 2 payment rows (deposit + balance) dated around the visit.
        const first = Math.min(collected, chance(0.4) ? Math.round(collected * 0.5) : collected);
        await db.insert(patientPayments).values({
          clinicId,
          patientId: patient.id,
          appointmentId: apptId,
          kind: "payment",
          amount: first,
          method: pick(methods),
          occurredAt: scheduledAt,
          createdBy: actor.id,
          createdByName: actor.name,
        });
        if (collected - first > 0) {
          await db.insert(patientPayments).values({
            clinicId,
            patientId: patient.id,
            appointmentId: apptId,
            kind: "payment",
            amount: collected - first,
            method: pick(methods),
            occurredAt: addDays(scheduledAt, int(1, 20)),
            createdBy: actor.id,
            createdByName: actor.name,
          });
        }
      }
    }
    return apptId;
  }

  // Past (last 180 days): ~1-2 per day on average.
  for (let d = 180; d >= 1; d--) {
    const day = addDays(NOW, -d);
    const wd = day.getDay();
    if (wd === 0) continue; // clinic closed Sunday
    const count = int(0, 3);
    for (let i = 0; i < count; i++) {
      const s = at(day, int(9, 16), pick([0, 30]));
      const status = chance(0.75) ? "completed" : chance(0.5) ? "cancelled" : "no_show";
      await makeAppointment(s, status);
    }
  }

  // Today: a live queue (scheduled/confirmed). Queue tokens are assigned in one
  // pass below (assignQueueTokens), exactly like the real booking flow.
  const todayCount = int(5, 9);
  for (let i = 0; i < todayCount; i++) {
    const s = at(NOW, int(9, 16), pick([0, 30]));
    await makeAppointment(s, chance(0.5) ? "confirmed" : "scheduled");
  }

  // Future (tomorrow → 5 weeks / 35 days): scheduled/confirmed.
  for (let d = 1; d <= 35; d++) {
    const day = addDays(NOW, d);
    if (day.getDay() === 0) continue;
    const count = int(0, 2);
    for (let i = 0; i < count; i++) {
      const s = at(day, int(9, 16), pick([0, 30]));
      await makeAppointment(s, chance(0.3) ? "confirmed" : "scheduled");
    }
  }
  console.log(`${made.length + todayCount} appointments (${completedWithBill} completed w/ bill)`);

  // ── recompute amount_collected cache from the ledger (payment − refund) ──────
  await db.execute(sql`
    update appointments a set amount_collected = coalesce((
      select sum(case when pp.kind = 'refund' then -pp.amount
                      when pp.kind in ('payment','advance_applied') then pp.amount else 0 end)
      from patient_payments pp
      where pp.appointment_id = a.id and pp.deleted_at is null
    ), 0)
    where a.clinic_id = ${clinicId}
  `);

  // ── assign queue tokens (appointment #) to every doctor appointment ─────────
  // Group by the app's real (doctor, day, window) session key and number FCFS by
  // time — exactly what withQueueNumber does at booking, for past/present/future.
  await assignQueueTokens(clinicId);

  // ── rebuild the derived revenue ledgers via the app's own logic ─────────────
  console.log("Backfilling sales / shares / settlements…");
  await backfillClinicSales(clinicId);

  // ── expense categories + expenses (incl. recurring) ─────────────────────────
  const catNames = ["Rent", "Salaries", "Supplies", "Lab", "Utilities", "Marketing", "Other"];
  const cats: { id: string; name: string }[] = [];
  for (const name of catNames) {
    const [row] = await db.insert(expenseCategories).values({ clinicId, name }).returning({ id: expenseCategories.id });
    cats.push({ id: row.id, name });
  }
  // one-off expenses across the last 6 months
  for (let d = 175; d >= 5; d -= int(4, 12)) {
    const day = addDays(NOW, -d);
    const cat = pick(cats);
    await db.insert(expenses).values({
      clinicId,
      categoryId: cat.id,
      amount: int(2, 60) * 1000,
      incurredOn: ymd(day),
      vendor: pick(["City Dental Supplies", "PharmaPlus", "K-Electric", "SmileLab", "Office Mart", null]),
      method: pick(methods),
      recurring: false,
      createdByName: "Demo Admin",
    });
  }
  // recurring templates due since last month (the cron will materialise them)
  const rentCat = cats.find((c) => c.name === "Rent")!;
  const salCat = cats.find((c) => c.name === "Salaries")!;
  await db.insert(expenses).values({
    clinicId, categoryId: rentCat.id, amount: 120000, incurredOn: ymd(addDays(NOW, -30)),
    vendor: "Landlord", method: "bank", recurring: true, recurrence: "monthly", nextRunOn: ymd(addDays(NOW, -1)),
    createdByName: "Demo Admin",
  });
  await db.insert(expenses).values({
    clinicId, categoryId: salCat.id, amount: 250000, incurredOn: ymd(addDays(NOW, -30)),
    vendor: "Staff payroll", method: "bank", recurring: true, recurrence: "monthly", nextRunOn: ymd(NOW),
    createdByName: "Demo Admin",
  });

  // ── recalls (overdue, due-soon, future) ─────────────────────────────────────
  for (let i = 0; i < 20; i++) {
    const p = pick(patientIds);
    const offset = pick([-40, -20, -7, -2, 3, 10, 30, 60]);
    const status = offset < 0 ? pick(["pending", "sent"]) : "pending";
    await db.insert(recalls).values({
      clinicId,
      patientId: p.id,
      module: "dental",
      reason: pick(["6-month cleaning", "Crown fit review", "Post-RCT check", "Whitening top-up"]),
      dueAt: addDays(NOW, offset),
      status: status as never,
      sentAt: status === "sent" ? addDays(NOW, offset - 1) : null,
    });
  }

  // ── whatsapp messages (queue) ───────────────────────────────────────────────
  for (let i = 0; i < 25; i++) {
    const p = pick(patientIds);
    const inbound = chance(0.4);
    await db.insert(whatsappMessages).values({
      clinicId,
      patientId: p.id,
      direction: inbound ? "inbound" : "outbound",
      phone: p.phone,
      status: inbound ? "received" : pick(["sent", "delivered", "read"]),
      templateName: inbound ? null : pick(["appointment_booked", "appointment_reminder", "recall_reminder"]),
      body: inbound
        ? pick(["Can I reschedule?", "What time is my appointment?", "Do you have an opening tomorrow?", "Thanks!"])
        : pick(["Your appointment is confirmed.", "Reminder: your visit is tomorrow.", "Time for your 6-month cleaning."]),
      createdAt: addDays(NOW, -int(0, 20)),
    });
  }

  // ── invoices for ~40% of completed visits ───────────────────────────────────
  const completed = made.filter((a) => a.status === "completed" && a.bill > 0);
  let invNo = 1;
  for (const a of completed) {
    if (!chance(0.4)) continue;
    await db.insert(invoices).values({
      clinicId,
      appointmentId: a.id,
      patientId: a.patientId,
      invoiceNo: invNo,
      issuedBy: null,
      issuedByName: "Demo Admin",
      issuedAt: addDays(a.scheduledAt, 0),
    });
    invNo++;
  }
  await db.execute(sql`update clinics set next_invoice_no = ${invNo} where id = ${clinicId}`);

  // ── a couple of doctor payouts (so Outstanding ≠ Earned) ────────────────────
  for (const doc of doctors.slice(0, 2)) {
    await db.insert(doctorPayouts).values({
      clinicId,
      doctorId: doc.id,
      doctorName: doc.name,
      amount: int(10, 40) * 1000,
      method: "bank",
      note: "Monthly payout",
      createdByName: "Demo Admin",
    });
  }

  console.log("\n✅ Demo clinic seeded.");
  console.log("   Login:  clinic002 / clinic002");
  console.log(`   Invoices issued: ${invNo - 1}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
