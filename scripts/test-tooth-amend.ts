/**
 * End-to-end check of per-tooth history, treatments, edit and delete, against a REAL
 * database. The pure logic is unit-tested in test-dental-chart.ts; this covers what
 * only exists once records are written and the living chart is re-folded. Creates its
 * own patient and removes it at the end.
 *
 * Run: tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-tooth-amend.ts
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { clinics, patients, visits } from "@/core/db/schema";
import { dentalCharts, dentalRecords } from "@/modules/dental/db/schema";
import { listClinicTrash, restoreForClinic } from "@/core/trash";
import { clinicModuleTrashRows, clinicTrashProvider } from "@/config/module-trash";
import {
  deleteToothRecord,
  editToothRecord,
  getPatientChart,
  listDentalRecords,
  recordToothTreatment,
  saveBaseline,
  setToothBaseline,
  saveDentalRecord,
  toothHistoryFor,
} from "@/modules/dental/db/records";

let failures = 0;
const norm = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : v;
function check(name: string, gotRaw: unknown, wantRaw: unknown) {
  const g = JSON.stringify(norm(gotRaw));
  const w = JSON.stringify(norm(wantRaw));
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
    .values({ clinicId: clinic.id, fullName: "ZZ chart probe" })
    .returning({ id: patients.id });
  const pid = patient.id;

  try {
    await saveBaseline(clinic.id, pid, { "18": { status: "caries" } });
    await recordToothTreatment(clinic.id, pid, "18", { status: "filled" });
    await recordToothTreatment(clinic.id, pid, "18", { status: "filled", endo: true });
    await recordToothTreatment(clinic.id, pid, "18", { status: "crown", endo: true });

    console.log("History, newest first:");
    const h = await toothHistoryFor(clinic.id, pid, "18");
    check("every treatment is its own entry", h.length, 4);
    check("newest is on top", h.map((e) => e.label), [
      "Filled → Crown",
      "Filled → Filled, root treated",
      "Caries → Filled",
      "Sound → Caries",
    ]);
    check("the intake entry is marked baseline", h[3].source, "baseline");
    check("the treatments are marked treatment", h.slice(0, 3).map((e) => e.source), [
      "treatment",
      "treatment",
      "treatment",
    ]);
    check("the chart shows the newest", (await getPatientChart(clinic.id, pid))["18"], { status: "crown", endo: true });

    console.log("\nEdit an entry in place:");
    const crown = h[0];
    check("edit succeeds", await editToothRecord(clinic.id, pid, "18", crown.recordId!, { status: "veneer", endo: true }), { ok: true });
    const afterEdit = await toothHistoryFor(clinic.id, pid, "18");
    check("the entry now reads the corrected treatment", afterEdit[0].label, "Filled → Veneer");
    check("no extra entry was created", afterEdit.length, 4);
    check("the chart follows the edit", (await getPatientChart(clinic.id, pid))["18"], { status: "veneer", endo: true });

    console.log("\nDelete an entry:");
    check("delete succeeds", await deleteToothRecord(clinic.id, pid, "18", crown.recordId!, pid), { ok: true });
    const afterDelete = await toothHistoryFor(clinic.id, pid, "18");
    check("the entry is gone from the history", afterDelete.length, 3);
    check("the chart reverts to what is left", (await getPatientChart(clinic.id, pid))["18"], { status: "filled", endo: true });
    check("the record is SOFT deleted, not erased", (await db.select().from(dentalRecords).where(eq(dentalRecords.patientId, pid))).length, 4);
    check("and it is hidden from live reads", (await listDentalRecords(clinic.id, pid)).length, 3);

    console.log("\nTrash — listed, filterable, restorable:");
    {
      const [p3] = await db
        .insert(patients)
        .values({ clinicId: clinic.id, fullName: "ZZ trash probe" })
        .returning({ id: patients.id });
      try {
        await recordToothTreatment(clinic.id, p3.id, "18", { status: "filled" });
        await recordToothTreatment(clinic.id, p3.id, "18", { status: "crown" });
        const crownRec = (await listDentalRecords(clinic.id, p3.id)).find(
          (r) => (r.chartAfter as Record<string, { status: string }> | null)?.["18"]?.status === "crown",
        )!;
        await deleteToothRecord(clinic.id, p3.id, "18", crownRec.id, p3.id);

        const rows = await clinicModuleTrashRows(clinic.id, 30);
        const mine = rows.filter((r) => r.label.includes("ZZ trash probe"));
        check("the deleted entry is listed in Trash", mine.length, 1);
        check("it says which tooth", mine[0]?.label.includes("tooth 18"), true);
        check("it says what it was", mine[0]?.detail, "Crown");

        const items = await listClinicTrash(clinic.id, 30, { type: "clinical_record" }, rows);
        check("the type filter finds it", items.some((i) => i.id === crownRec.id), true);
        check("and excludes everything else", items.every((i) => i.entity === "clinical_record"), true);

        await restoreForClinic(clinic.id, mine[0].group, await clinicTrashProvider(clinic.id));
        check("restoring puts the chart back", (await getPatientChart(clinic.id, p3.id))["18"], { status: "crown" });
        check("and it leaves Trash", (await clinicModuleTrashRows(clinic.id, 30)).filter((r) => r.label.includes("ZZ trash probe")).length, 0);
      } finally {
        await db.delete(dentalRecords).where(eq(dentalRecords.patientId, p3.id));
        await db.delete(dentalCharts).where(eq(dentalCharts.patientId, p3.id));
        await db.delete(patients).where(eq(patients.id, p3.id));
      }
    }

    console.log("\nAn intake entry can be corrected and removed:");
    {
      const [p4] = await db
        .insert(patients)
        .values({ clinicId: clinic.id, fullName: "ZZ baseline probe" })
        .returning({ id: patients.id });
      try {
        await setToothBaseline(clinic.id, p4.id, "18", { status: "crown" });
        await setToothBaseline(clinic.id, p4.id, "26", { status: "root_canal" });
        let h4 = await toothHistoryFor(clinic.id, p4.id, "18");
        check("it is recorded as intake, not a treatment", h4[0].source, "baseline");

        // Both were refused before, which left a mistaken "already there" unfixable
        // once the separate intake editor was removed.
        check("editing it works", await editToothRecord(clinic.id, p4.id, "18", h4[0].recordId!, { status: "veneer" }), { ok: true });
        h4 = await toothHistoryFor(clinic.id, p4.id, "18");
        check("the entry is corrected in place", h4[0].label, "Sound → Veneer");
        check("no second entry appears", h4.length, 1);
        check("the chart follows", (await getPatientChart(clinic.id, p4.id))["18"], { status: "veneer" });

        check("deleting it works", await deleteToothRecord(clinic.id, p4.id, "18", h4[0].recordId!, p4.id), { ok: true });
        check("the entry is gone", (await toothHistoryFor(clinic.id, p4.id, "18")).length, 0);
        check("and so is the tooth", (await getPatientChart(clinic.id, p4.id))["18"] ?? null, null);
        check("other intake teeth are untouched", (await getPatientChart(clinic.id, p4.id))["26"], { status: "root_canal" });
      } finally {
        await db.delete(dentalRecords).where(eq(dentalRecords.patientId, p4.id));
        await db.delete(dentalCharts).where(eq(dentalCharts.patientId, p4.id));
        await db.delete(patients).where(eq(patients.id, p4.id));
      }
    }

    console.log("\nWhat may not be changed from here:");
    const [v] = await db
      .insert(visits)
      .values({ clinicId: clinic.id, patientId: pid, module: "dental", status: "approved", visitDate: new Date() })
      .returning({ id: visits.id });
    const visitRec = await saveDentalRecord(clinic.id, { patientId: pid, visitId: v.id, chartAfter: { "18": { status: "crown" } } });
    check("a visit entry cannot be deleted here", await deleteToothRecord(clinic.id, pid, "18", visitRec.id, pid), {
      error: "This came from a visit. Open the visit to change it.",
    });
    check("a visit entry cannot be edited here", await editToothRecord(clinic.id, pid, "18", visitRec.id, { status: "veneer" }), {
      error: "This came from a visit. Open the visit to change it.",
    });
    check("a visit entry is marked as such", (await toothHistoryFor(clinic.id, pid, "18"))[0].source, "visit");
  } finally {
    await db.delete(dentalRecords).where(eq(dentalRecords.patientId, pid));
    await db.delete(visits).where(eq(visits.patientId, pid));
    await db.delete(dentalCharts).where(eq(dentalCharts.patientId, pid));
    await db.delete(patients).where(eq(patients.id, pid));
    console.log("\nprobe patient removed");
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
