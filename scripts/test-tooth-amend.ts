/**
 * End-to-end check of per-tooth history + amendment against a REAL database.
 *
 * The pure logic is unit-tested in test-dental-chart.ts; this asserts the parts that
 * only exist once records are written and the living chart is re-folded: that an
 * amendment reverts the chart, keeps the mistaken entry in the history, and does not
 * delete anything. Creates its own patient and removes it at the end.
 *
 * Run: tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-tooth-amend.ts
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, patients } from "@/core/db/schema";
import { dentalCharts, dentalRecords } from "@/modules/dental/db/schema";
import {
  amendTooth,
  getPatientChart,
  saveDentalRecord,
  toothHistoryFor,
} from "@/modules/dental/db/records";

let failures = 0;
const norm = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : v;
function check(name: string, gotRaw: unknown, wantRaw: unknown) {
  const got = norm(gotRaw);
  const want = norm(wantRaw);
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

async function main() {
  const [clinic] = await db.select({ id: clinics.id }).from(clinics).limit(1);
  if (!clinic) throw new Error("no clinic in this database");

  const [patient] = await db
    .insert(patients)
    .values({ clinicId: clinic.id, fullName: "ZZ amend probe", phone: null })
    .returning({ id: patients.id });
  const pid = patient.id;

  try {
    // 18 over three visits: filled → root-treated → crowned.
    const r1 = await saveDentalRecord(clinic.id, { patientId: pid, chartAfter: { "18": { status: "filled" } } });
    const r2 = await saveDentalRecord(clinic.id, { patientId: pid, chartAfter: { "18": { status: "filled", endo: true } } });
    const r3 = await saveDentalRecord(clinic.id, { patientId: pid, chartAfter: { "18": { status: "crown", endo: true } } });

    console.log("Per-tooth history from real records:");
    const h = await toothHistoryFor(clinic.id, pid, "18");
    check("three entries", h.length, 3);
    check("read oldest first", h.map((e) => e.label), [
      "Sound → Filled",
      "Filled → Filled, root treated",
      "Filled → Crown",
    ]);
    check("the living chart shows the crown", (await getPatientChart(clinic.id, pid))["18"], {
      status: "crown",
      endo: true,
    });

    console.log("\nAmend the crown (charted by mistake):");
    const res = await amendTooth(clinic.id, pid, "18", r3.id);
    check("amend succeeded", res, { ok: true });
    check("chart reverted to the root-treated filling", (await getPatientChart(clinic.id, pid))["18"], {
      status: "filled",
      endo: true,
    });

    const after = await toothHistoryFor(clinic.id, pid, "18");
    check("the mistaken crown is STILL in the history", after.length, 4);
    check("the crown entry survives", after[2].label, "Filled → Crown");
    check("the last entry is flagged a correction", after[3].isCorrection, true);
    check("nothing was deleted", (await db.select().from(dentalRecords).where(eq(dentalRecords.patientId, pid))).length, 4);

    console.log("\nAmend the very first entry (revert to sound):");
    await amendTooth(clinic.id, pid, "18", r1.id);
    // Frames are snapshots, so undoing the filling must NOT discard what came after
    // it. Folding without r1 leaves the correction that reverted the crown, i.e. the
    // root-treated filling from r2.
    check("undoing an old entry keeps the later ones", (await getPatientChart(clinic.id, pid))["18"], {
      status: "filled",
      endo: true,
    });

    console.log("\nGuards:");
    check("amending an entry that never touched this tooth is refused", await amendTooth(clinic.id, pid, "27", r2.id), {
      error: "That entry is no longer on this tooth.",
    });
    check("an untouched tooth has no history", await toothHistoryFor(clinic.id, pid, "27"), []);
  } finally {
    await db.delete(dentalRecords).where(eq(dentalRecords.patientId, pid));
    await db.delete(dentalCharts).where(eq(dentalCharts.patientId, pid));
    await db.delete(patients).where(eq(patients.id, pid));
    console.log("\nprobe patient removed");
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
