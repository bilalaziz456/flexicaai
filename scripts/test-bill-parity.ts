/**
 * DIFFERENTIAL TEST — the TypeScript bill vs the SQL bill (delta D-02, ADR-015).
 *
 * The amount a visit costs is computed in two languages: `computeBill` in TS (what
 * the invoice, receipt and booking form render) and a SQL expression (what the
 * appointment list, receivables, invoice list and dashboard KPIs aggregate, because
 * doing it per-row in JS would be N+1). Both are necessary. What was NOT acceptable
 * is that the only thing keeping them equal was four comments asserting they
 * "mirror" each other.
 *
 * This is the contract between them. It builds randomised appointments — consultation
 * charged or not, flat and percentage discounts, per-line discounts stacked under an
 * appointment-level one, pending/rejected approvals, zero-fee and over-100% edge
 * cases — then asserts the two agree TO THE RUPEE on real rows in Postgres.
 *
 * It imports the REAL helpers, not copies, so it fails if either side drifts.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-bill-parity.ts`
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import {
  appointmentProcedures,
  appointments,
  clinics,
  patients,
  procedures,
  users,
} from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import {
  computeBill,
  effectiveDiscountValue,
  type DiscountType,
  type ProcedureLineInput,
} from "@/core/appointments/fee";
import { appointmentNetSql } from "@/core/appointments/bill-sql";
import {
  appointmentProceduresGrossSql,
  appointmentProceduresNetSql,
  procedureTotals,
} from "@/core/appointments/procedures";
import type { DiscountStatusCode } from "@/core/db/vocabulary-seed";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

// Deterministic PRNG — a failing run must be reproducible, and `Math.random()` would
// make a red build unrepeatable.
//
// mulberry32, using Math.imul. A textbook LCG (`seed * 1103515245 + 12345`) is wrong
// in JS: the multiply blows past 2^53, loses precision, and the sequence degenerates
// to a handful of values. The first version of this file did exactly that, and the
// coverage assertions below caught it — 60 "random" cases that never once produced a
// per-line discount. Hence those assertions: a generator that silently stops varying
// leaves a test passing while proving nothing.
let seed = 20260821;
function rnd(n: number): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) % n;
}
const pick = <T,>(xs: T[]): T => xs[rnd(xs.length)];

const uniq = Date.now();
let clinicId = "";
let doctorId = "";
let patientId = "";
const procIds: string[] = [];

type Case = {
  fee: number;
  chargeConsultation: boolean;
  discountType: DiscountType;
  discountValue: number;
  discountStatus: DiscountStatusCode;
  lines: { procIdx: number; quantity: number; discountType: DiscountType; discountValue: number }[];
};

async function seedWorld() {
  clinicId = (
    await db.insert(clinics).values({ name: `bill parity ${uniq}` }).returning({ id: clinics.id })
  )[0].id;
  patientId = (
    await db
      .insert(patients)
      .values({ clinicId, fullName: "Parity Patient" })
      .returning({ id: patients.id })
  )[0].id;
  doctorId = (
    await db
      .insert(users)
      .values({
        clinicId,
        username: `parity_${uniq}`,
        passwordHash: "x",
        role: "doctor",
        fullName: "Parity Doctor",
        consultationFee: 0, // set per case
      })
      .returning({ id: users.id })
  )[0].id;

  // A price list with awkward numbers, so rounding differences surface.
  for (const price of [1500, 999, 3333, 20000, 1]) {
    const [p] = await db
      .insert(procedures)
      .values({ clinicId, name: `P${price}`, price })
      .returning({ id: procedures.id });
    procIds.push(p.id);
  }
}

/** Build the appointment + lines for one case, and return its id. */
async function materialise(c: Case): Promise<string> {
  await db.update(users).set({ consultationFee: c.fee }).where(eq(users.id, doctorId));

  const [appt] = await db
    .insert(appointments)
    .values({
      clinicId,
      patientId,
      doctorId,
      module: "dental",
      scheduledAt: new Date(),
      status: "completed",
      chargeConsultation: c.chargeConsultation,
      discountType: c.discountType,
      discountValue: c.discountValue,
      discountStatus: c.discountStatus,
    })
    .returning({ id: appointments.id });

  if (c.lines.length) {
    await db.insert(appointmentProcedures).values(
      c.lines.map((l) => ({
        clinicId,
        appointmentId: appt.id,
        procedureId: procIds[l.procIdx],
        name: `P${l.procIdx}`,
        unitPrice: [1500, 999, 3333, 20000, 1][l.procIdx],
        quantity: l.quantity,
        discountType: l.discountType,
        discountValue: l.discountValue,
      })),
    );
  }
  return appt.id;
}

/** What TS says this case costs. */
function tsBill(c: Case) {
  const lines: ProcedureLineInput[] = c.lines.map((l) => ({
    unitPrice: [1500, 999, 3333, 20000, 1][l.procIdx],
    quantity: l.quantity,
    discountType: l.discountType,
    discountValue: l.discountValue,
  }));
  return computeBill(
    c.chargeConsultation ? c.fee : 0,
    lines,
    c.discountType,
    // The SQL zeroes a pending/rejected discount, so TS must be handed the same
    // input. `effectiveDiscountValue` is the shared gate both sides go through.
    effectiveDiscountValue(c.discountStatus, c.discountValue),
  );
}

/** What Postgres says, via the production SQL expressions. */
async function sqlBill(appointmentId: string) {
  const [row] = await db
    .select({
      net: appointmentNetSql(),
      pGross: appointmentProceduresGrossSql(),
      pNet: appointmentProceduresNetSql(),
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .where(sql`${appointments.clinicId} = ${clinicId} and ${appointments.id} = ${appointmentId}`);
  return {
    net: Number(row.net),
    proceduresGross: Number(row.pGross),
    proceduresNet: Number(row.pNet),
  };
}

/**
 * The same bill, read through the JOINED pre-aggregate instead of the correlated
 * subqueries — the P0 shape (`procedures.ts#procedureTotals`).
 *
 * This is the whole reason it is safe to have two ways of feeding the formula. They
 * share one expression in `bill-sql.ts`, so they cannot drift in the ARITHMETIC; what
 * a test still has to prove is that the two ways of obtaining the INPUTS agree — in
 * particular that a LEFT JOIN with no matching row yields 0 exactly where the
 * correlated `coalesce(..., 0)` did, which is every appointment with no procedures.
 */
async function joinedSqlBill(appointmentId: string) {
  const pt = procedureTotals(clinicId);
  const [row] = await db
    .select({
      net: appointmentNetSql(pt),
      pGross: sql<number>`coalesce(${pt.gross}, 0)`,
      pNet: sql<number>`coalesce(${pt.net}, 0)`,
    })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.doctorId))
    .leftJoin(pt, eq(pt.appointmentId, appointments.id))
    .where(sql`${appointments.clinicId} = ${clinicId} and ${appointments.id} = ${appointmentId}`);
  return {
    net: Number(row.net),
    proceduresGross: Number(row.pGross),
    proceduresNet: Number(row.pNet),
  };
}

/**
 * A discount value appropriate to its TYPE. A percentage is capped at 100 by a DB
 * CHECK (D-17), so generating 5000% here would test nothing but the constraint — it
 * would just fail the insert. A flat AMOUNT is deliberately allowed to exceed the
 * bill, because that is the case where clamping actually has to work and where the
 * two implementations could disagree.
 */
function discountFor(type: DiscountType): number {
  return type === "percent"
    ? pick([0, 0, 10, 25, 50, 100]) // 100 = free, the boundary
    : pick([0, 0, 200, 500, 5000, 99999]); // large ones must clamp to the bill
}

function randomCase(): Case {
  const nLines = rnd(4); // 0–3
  const discountType = pick<DiscountType>(["amount", "percent"]);
  return {
    fee: pick([0, 500, 1500, 2000, 7777]),
    chargeConsultation: rnd(4) > 0, // mostly true, sometimes a procedure-only visit
    discountType,
    discountValue: discountFor(discountType),
    discountStatus: pick(["none", "none", "none", "approved", "pending", "rejected"]),
    lines: Array.from({ length: nLines }, () => {
      const t = pick<DiscountType>(["amount", "percent"]);
      return {
        procIdx: rnd(5),
        quantity: 1 + rnd(4),
        discountType: t,
        discountValue: discountFor(t),
      };
    }),
  };
}

async function main() {
  await seedWorld();

  console.log("Randomised parity — TS computeBill vs the SQL expression:");
  const CASES = 60;
  let mismatches = 0;
  let joinedMismatches = 0;
  let withLineDiscounts = 0;
  let clamped = 0;
  let noLines = 0;

  for (let i = 0; i < CASES; i++) {
    const c = randomCase();
    const id = await materialise(c);
    const ts = tsBill(c);
    const pg = await sqlBill(id);
    // The joined pre-aggregate must return the SAME numbers as the correlated form
    // for every case, including the ones with no procedure lines at all — that is
    // where a LEFT JOIN and a `coalesce(subquery, 0)` could differ.
    const jn = await joinedSqlBill(id);

    if (ts.proceduresDiscount > 0) withLineDiscounts++;
    if (ts.appointmentDiscount > 0 && ts.net === 0) clamped++;
    if (c.lines.length === 0) noLines++;

    if (jn.net !== pg.net || jn.proceduresNet !== pg.proceduresNet || jn.proceduresGross !== pg.proceduresGross) {
      joinedMismatches++;
      if (joinedMismatches <= 3) {
        console.log(
          `  ✗ case ${i} — joined ≠ correlated\n      correlated net=${pg.net} pGross=${pg.proceduresGross} pNet=${pg.proceduresNet}\n      joined     net=${jn.net} pGross=${jn.proceduresGross} pNet=${jn.proceduresNet}`,
        );
      }
    }

    if (ts.net !== pg.net || ts.proceduresNet !== pg.proceduresNet || ts.proceduresGross !== pg.proceduresGross) {
      mismatches++;
      if (mismatches <= 3) {
        console.log(
          `  ✗ case ${i} diverged\n      case ${JSON.stringify(c)}\n      ts   net=${ts.net} pGross=${ts.proceduresGross} pNet=${ts.proceduresNet}\n      sql  net=${pg.net} pGross=${pg.proceduresGross} pNet=${pg.proceduresNet}`,
        );
      }
    }
  }
  check(`${CASES} randomised bills agree to the rupee`, mismatches, 0);
  check(`…and the JOINED pre-aggregate agrees with the correlated form`, joinedMismatches, 0);
  check("…on cases with no procedure lines too (LEFT JOIN vs coalesce)", noLines > 0, true);
  // Guard the generator itself: a run that never exercises the interesting paths
  // would pass while proving nothing.
  check("…and the run actually exercised per-line discounts", withLineDiscounts > 0, true);
  check("…and discounts that clamp to zero", clamped > 0, true);

  console.log("\nThe layered discount is the case the two most easily disagree on:");
  {
    // consultation 1000 + (2000 gross − 500 line) = 2500 subtotal, less 10% = 2250.
    // A formula that applied the 10% to the GROSS 3000 would say 2700.
    const c: Case = {
      fee: 1000,
      chargeConsultation: true,
      discountType: "percent",
      discountValue: 10,
      discountStatus: "none",
      lines: [{ procIdx: 0, quantity: 2, discountType: "amount", discountValue: 500 }], // 1500×2 = 3000 − 500
    };
    const id = await materialise(c);
    const ts = tsBill(c);
    const pg = await sqlBill(id);
    check("TS: line discount applies BEFORE the appointment discount", ts.net, 3150);
    check("SQL agrees", pg.net, ts.net);
    check("gross stays pre-discount (consultation + line gross)", ts.gross, 4000);
    check("…and total discount is line + appointment", ts.discount, 4000 - 3150);
  }

  console.log("\nApproval gating is applied identically on both sides:");
  {
    const base = {
      fee: 1000,
      chargeConsultation: true,
      discountType: "amount" as DiscountType,
      discountValue: 400,
      lines: [],
    };
    for (const [status, expected] of [
      ["none", 600],
      ["approved", 600],
      ["pending", 1000],
      ["rejected", 1000],
    ] as const) {
      const c: Case = { ...base, discountStatus: status };
      const id = await materialise(c);
      const pg = await sqlBill(id);
      check(`'${status}' → net ${expected}`, pg.net, expected);
      check(`…TS matches on '${status}'`, tsBill(c).net, expected);
    }
  }

  // Hard delete: scaffolding, not clinic data.
  await unscoped("test cleanup", async () => {
    await db.delete(appointmentProcedures).where(eq(appointmentProcedures.clinicId, clinicId));
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(procedures).where(eq(procedures.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
    await db.delete(users).where(eq(users.clinicId, clinicId));
    await db.delete(clinics).where(eq(clinics.id, clinicId));
  });
  console.log("\nseeded rows removed");
}

main()
  .catch((e) => {
    failures++;
    console.error(e);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
