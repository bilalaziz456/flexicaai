/**
 * The money-path vocabulary REFERENCE TABLES and their foreign keys
 * (migrations `0087`–`0089`).
 *
 * Replaces `test-vocabulary-bounds.ts`, which exercised the CHECK constraints of
 * `0084`/`0085`. The FK subsumes those, so that coverage moved here rather than being
 * lost: every one of the 16 columns is still proven to refuse a value outside its
 * vocabulary, by a different mechanism.
 *
 * Three things are asserted, each catching a different failure:
 *
 * 1. **The seed matches `vocabulary-seed.ts`, row for row.** An integer surrogate key
 *    means nothing unless the same number means the same thing everywhere; a seed that
 *    drifted from the constants would reclassify money in silence — a refund read back
 *    as a payment moves a P&L and raises nothing.
 * 2. **The FK is declared on every column, and bites.** A constraint nobody exercised
 *    is decorative.
 * 3. **The custom column type round-trips.** `core/db/schema/vocabulary.ts` stores the
 *    integer but presents the code, which is what let ~120 read sites stay unchanged.
 *    If that mapping broke they would all be silently wrong rather than failing, so it
 *    is proven through a real write and read.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { appointments } from "@/core/db/schema";
import { ALL_VOCABULARY_SEED, VOCABULARY_SEED, idOf, PAYMENT_KIND_ROWS } from "@/core/db/vocabulary-seed";

/** Every source file under src/, so the scan cannot miss a new offender. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

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

const ROLLBACK = Symbol("rollback");
function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}

/** Every column carrying a vocabulary FK, and the table it points at. */
const COLUMNS: [string, string, string][] = [
  ["patient_payments", "kind_id", "payment_kinds"],
  ["patient_payments", "method_id", "payment_methods"],
  ["clinic_payments", "kind_id", "clinic_payment_kinds"],
  ["clinic_payments", "method_id", "payment_methods"],
  ["doctor_payouts", "method_id", "payment_methods"],
  ["expenses", "method_id", "payment_methods"],
  ["company_expenses", "method_id", "payment_methods"],
  ["doctor_settlement_actions", "kind_id", "settlement_kinds"],
  ["discount_settlements", "party_id", "settlement_parties"],
  ["appointment_discount_approvals", "approver_kind_id", "settlement_parties"],
  ["appointment_discount_approvals", "status_id", "approval_statuses"],
  ["appointment_procedures", "discount_type_id", "discount_types"],
  ["appointments", "discount_type_id", "discount_types"],
  ["appointments", "discount_split_type_id", "discount_types"],
  ["appointments", "discount_borne_by_id", "discount_bearers"],
  ["appointments", "discount_status_id", "discount_statuses"],
  // Enum-backed (migration 0090) — the column keeps its plain name.
  ["appointments", "status", "appointment_statuses"],
  ["visits", "status", "visit_statuses"],
  ["recalls", "status", "recall_statuses"],
  ["users", "role", "user_roles"],
  ["users", "theme", "theme_preferences"],
  ["whatsapp_messages", "direction", "whatsapp_directions"],
  ["whatsapp_messages", "status", "whatsapp_statuses"],
  // Formerly free text with no guard at all (migration 0092).
  ["clinics", "status", "clinic_statuses"],
  ["clinics", "billing_cycle", "billing_cycles"],
  ["clinics", "invoice_paper", "invoice_papers"],
  ["treatment_plans", "status", "treatment_plan_statuses"],
  ["treatment_plan_items", "status", "treatment_item_statuses"],
  ["clinical_attachments", "kind", "attachment_kinds"],
  ["import_batches", "status", "import_batch_statuses"],
  ["announcements", "level", "announcement_levels"],
  ["ai_usage", "provider", "ai_providers"],
  ["platform_cost_rates", "tax_mode", "tax_modes"],
  ["expenses", "recurrence", "recurrences"],
  ["company_expenses", "recurrence", "recurrences"],
  ["appointments", "source", "appointment_sources"],
];

async function main() {
  await unscoped("reference tables are company-global, not tenant data", async () => {
    console.log("\nMoney-path vocabulary tables + foreign keys\n");

    for (const [table, rows] of Object.entries(VOCABULARY_SEED)) {
      const live = (
        await db.execute(sql.raw(`select id, code, label from "${table}" order by id`))
      ).rows as { id: number; code: string; label: string }[];
      const same =
        live.length === rows.length &&
        rows.every(
          (r, i) => live[i].id === r.id && live[i].code === r.code && live[i].label === r.label,
        );
      ok(`${table}: ${rows.length} rows match vocabulary-seed.ts`, same);
    }

    // Read the FKs off the catalogue rather than trusting them: a column that quietly
    // lost its constraint looks identical from the application side.
    const declared = (
      await db.execute(sql`
        select cl.relname as tbl, a.attname as col, ft.relname as ref
        from pg_constraint c
        join pg_class cl on cl.oid = c.conrelid
        join pg_class ft on ft.oid = c.confrelid
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f'
      `)
    ).rows as { tbl: string; col: string; ref: string }[];
    let missing = 0;
    for (const [tbl, col, ref] of COLUMNS) {
      if (!declared.some((d) => d.tbl === tbl && d.col === col && d.ref === ref)) {
        missing++;
        console.log(`       missing FK: ${tbl}.${col} -> ${ref}`);
      }
    }
    ok(`all ${COLUMNS.length} vocabulary columns carry their FK`, missing === 0);

    const [appt] = (await db.execute(sql`select id from appointments limit 1`)).rows as {
      id: string;
    }[];
    if (!appt) {
      fail++;
      console.log("  FAIL no appointment to exercise the FK against");
    } else {
      let refused = false;
      try {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`update appointments set discount_status_id = 9999 where id = ${appt.id}::uuid`,
          );
          throw ROLLBACK;
        });
      } catch (e) {
        if (e !== ROLLBACK) refused = pgCode(e) === "23503";
      }
      ok("the FK refuses an id no vocabulary row has", refused);

      // The custom type round-trips: a code goes in, the INTEGER is stored, the code
      // comes back. This is what keeps every unchanged read site correct.
      let stored: number | null = null;
      let readBack: string | null = null;
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(appointments)
            .set({ discountStatus: "rejected" })
            .where(eq(appointments.id, appt.id));
          const raw = (
            await tx.execute(
              sql`select discount_status_id as v from appointments where id = ${appt.id}::uuid`,
            )
          ).rows as { v: number }[];
          stored = raw[0].v;
          const [row] = await tx
            .select({ s: appointments.discountStatus })
            .from(appointments)
            .where(eq(appointments.id, appt.id));
          readBack = row.s;
          throw ROLLBACK;
        });
      } catch (e) {
        if (e !== ROLLBACK) throw e;
      }
      ok("writing a code stores the INTEGER id", stored === 4, `stored ${stored}`);
      ok("reading it back gives the code again", readBack === "rejected", `got ${readBack}`);
    }

    // The codes must not be written out a second time anywhere in core. Five modules
    // used to restate them (APPOINTMENT_STATUSES, CLINIC_STATUSES, PAYMENT_METHODS,
    // USER_ROLES, THEME_PREFERENCES) and are now derived from the seed instead — this
    // is what stops the next one being pasted back in. A literal array of quoted codes
    // that exactly matches a vocabulary is the shape to catch.
    const seedFile = "src/core/db/vocabulary-seed.ts";
    const duplicates: string[] = [];
    for (const file of sourceFiles("src")) {
      if (file.split("\\").join("/").endsWith(seedFile)) continue;
      const text = stripComments(readFileSync(file, "utf8"));
      const flat = text.replace(/\s+/g, "");
      for (const [table, rows] of Object.entries(ALL_VOCABULARY_SEED)) {
        if (rows.length < 3) continue; // two-value sets collide with unrelated pairs
        const codes = rows.map((r) => r.code);
        // Substring match on a whitespace-stripped copy, deliberately not a regex: the
        // first attempt built one inside a template literal, where `\[` and `\s` lose
        // their backslashes and become a character class that matches nearly every file.
        if (flat.includes(codes.map((c) => `"${c}"`).join(","))) {
          duplicates.push(`${file} restates ${table}`);
        }
      }
    }
    ok("no module restates a vocabulary's codes", duplicates.length === 0, duplicates.join("; "));

    let threw = false;
    try {
      idOf(PAYMENT_KIND_ROWS, "not_a_kind");
    } catch {
      threw = true;
    }
    ok("an unseeded code throws when mapped, rather than storing something else", threw);

    let blocked = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`delete from discount_types where code = 'amount'`);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) blocked = pgCode(e) === "23503";
    }
    ok("a vocabulary row still referenced cannot be deleted", blocked);

    console.log(`\n${pass} passed, ${fail} failed\n`);
  });
  process.exit(fail === 0 ? 0 : 1);
}

main();

/** Comments removed, so prose that merely mentions a code list is not flagged. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
