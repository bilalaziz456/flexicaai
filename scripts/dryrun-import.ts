/**
 * Import dry run on the sample spreadsheets in D:\import-samples\. Shows what the
 * previewImport (dry run — no writes) makes of messy real-world data, before and
 * after column mapping; then commits into a THROWAWAY clinic to prove the values
 * land, and reads them back. Everything is cleaned up.
 * Run: tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/dryrun-import.ts
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../src/core/db";
import { clinics, patients, users } from "../src/core/db/schema";
import { byClinic, notDeleted } from "../src/core/db/tenant";
import { previewImport, commitImport, FIELDS } from "../src/core/admin/import";
import type { ImportEntity, ImportPreview } from "../src/core/admin/import";
import { formatMrn } from "../src/core/patients/mrn";
import { ageFromDob } from "../src/core/lib/age";

const DIR = "D:/import-samples";
const readBuf = (name: string): ArrayBuffer => Uint8Array.from(fs.readFileSync(`${DIR}/${name}`)).buffer;
const actor = { id: randomUUID(), name: "Dry Run" };

function show(label: string, entity: ImportEntity, p: ImportPreview) {
  console.log(`\n── ${label} ──`);
  console.log(`   rows=${p.totalRows}  ready=${p.ready}  duplicates=${p.duplicates}  errors=${p.errored}  warnings=${p.warnings}`);
  const missing = FIELDS[entity].filter((f) => f.required && !p.mapping[f.key]).map((f) => f.label);
  const mapped = Object.entries(p.mapping).map(([k, v]) => `${k}←"${v}"`).join(", ");
  console.log(`   mapping: ${mapped || "(none detected)"}`);
  if (missing.length) console.log(`   ⚠ required not mapped: ${missing.join(", ")}`);
  for (const i of p.issues) console.log(`   • row ${i.row} [${i.level}] ${i.message}`);
}

async function main() {
  const [clinic] = await db.insert(clinics).values({ name: `DRY RUN ${Date.now()}` }).returning({ id: clinics.id });
  const cid = clinic.id;
  await db.insert(users).values({ clinicId: cid, username: `dr${Date.now()}`, passwordHash: "x", role: "doctor", fullName: "Bilal Aziz" });

  try {
    console.log("========== PATIENTS ==========");
    const pbuf = readBuf("patients-sample.csv");
    show("Dry run, NO mapping (auto-detect only)", "patients", await previewImport(cid, "patients", "patients-sample.csv", pbuf));

    const pmap = { external_ref: "file_#", opening_balance: "balance_due" };
    show("Dry run, WITH mapping (file_# → old no., balance_due → opening)", "patients", await previewImport(cid, "patients", "patients-sample.csv", pbuf, pmap));

    console.log("\n── Committing the ready rows (throwaway clinic) to show values land ──");
    const res = await commitImport(cid, "patients", "patients-sample.csv", pbuf, actor, pmap);
    console.log(`   imported=${res.imported} skipped=${res.skipped} errored=${res.errored}`);
    const rows = await db
      .select({ mrn: patients.mrn, createdAt: patients.createdAt, name: patients.fullName, phone: patients.phone, ext: patients.externalRef, opening: patients.openingBalance, dob: patients.dateOfBirth })
      .from(patients)
      .where(byClinic(patients.clinicId, cid, notDeleted(patients.deletedAt)))
      .orderBy(patients.mrn);
    console.table(
      rows.map((r) => ({
        MRN: formatMrn("KL-", r.mrn, r.createdAt),
        Name: r.name,
        Phone: r.phone,
        "Old no.": r.ext,
        Age: ageFromDob(r.dob) ?? "",
        "Opening (PKR)": r.opening,
      })),
    );

    console.log("\n========== PROCEDURES ==========");
    const cbuf = readBuf("procedures-sample.csv");
    show("Dry run (headers auto-detect cleanly)", "procedures", await previewImport(cid, "procedures", "procedures-sample.csv", cbuf));

    console.log("\n========== CLINICAL NOTES ==========");
    const vbuf = readBuf("visits-sample.csv");
    show("Dry run, NO mapping ('Old File' not detected → patients unmatched)", "visits", await previewImport(cid, "visits", "visits-sample.csv", vbuf));
    show("Dry run, WITH mapping (Old File → patient old no.)", "visits", await previewImport(cid, "visits", "visits-sample.csv", vbuf, { external_ref: "old_file" }));
  } finally {
    await db.delete(clinics).where(eq(clinics.id, cid));
    console.log("\n(throwaway clinic cleaned up)");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
