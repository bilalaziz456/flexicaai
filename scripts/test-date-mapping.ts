/**
 * A raw SQL aggregate over a timestamp column must be MAPPED, not merely asserted.
 *
 * `sql<Date>` is a TypeScript assertion and nothing more. A bare aggregate such as
 * `min(created_at)` carries no column metadata, so the driver hands back the raw
 * timestamptz STRING while tsc believes it is a Date. The value reaches a component,
 * `.toLocaleDateString()` is not a function, and the page crashes at runtime having
 * type-checked perfectly. That is exactly how `/admin/logs` broke for the super admin.
 *
 * `.mapWith(column)` applies that column's own driver mapper and makes the declared
 * type true.
 *
 * Both halves matter. The behavioural check proves the values are Dates today; the
 * static scan is what catches the NEXT one, because a query over an empty table
 * returns null and would satisfy the behavioural half while still being wrong.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { getActivityLogStats } from "@/core/audit/retention";
import { getFirstPaymentDates } from "@/core/admin/billing";

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

/** Every source file under src/, so the scan cannot miss a new offender. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Files declaring `sql<Date…>` with no `.mapWith` alongside it.
 *
 * Line-based on purpose. A regex over the whole file flags the prose that DOCUMENTS
 * this rule — the comments above contain the literal `sql<Date>` between backticks —
 * and a guard that cries wolf on the file explaining it is one people learn to ignore.
 * So comment lines are skipped, and the mapper is allowed to sit on a following line
 * because the call is usually wrapped by the formatter.
 */
function unmappedDateSql(): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("sql<Date")) continue;
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      const window = lines.slice(i, i + 4).join("\n");
      if (!window.includes(".mapWith")) offenders.push(`${file}:${i + 1}`);
    }
  }
  return offenders;
}

async function main() {
  console.log("\nRaw SQL date aggregates are mapped, not just asserted\n");

  const stats = await getActivityLogStats();
  ok(
    "getActivityLogStats returns a real Date",
    stats.oldest === null || stats.oldest instanceof Date,
    `typeof ${typeof stats.oldest}`,
  );
  ok(
    "…so the admin logs page can format it",
    stats.oldest === null || typeof stats.oldest.toLocaleDateString === "function",
  );

  const clinicIds = await unscoped("test reads clinic ids", async () =>
    ((await db.execute(sql`select id from clinics limit 5`)).rows as { id: string }[]).map(
      (c) => c.id,
    ),
  );
  const firsts = await getFirstPaymentDates(clinicIds);
  const values = [...firsts.values()];
  ok(
    "getFirstPaymentDates returns real Dates",
    values.every((d) => d instanceof Date),
    `${values.length} value(s) checked`,
  );

  const offenders = unmappedDateSql();
  ok("no `sql<Date>` in the codebase lacks .mapWith", offenders.length === 0, offenders.join(", "));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
