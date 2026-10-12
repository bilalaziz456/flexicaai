/**
 * ONE-TIME (and safe to re-run): re-derive every visit's sales, doctor shares and
 * discount settlements under the money-day rules of 2026-10-13 — revenue counts on the
 * DAY it is received, whatever the visit's status.
 *
 * WHY A SCRIPT AND NOT THE NIGHTLY RECONCILE: reconcile compares each visit's TOTAL,
 * and moving a sale from the visit date to the payment date keeps the total the same,
 * so it would never notice. Every visit goes through `recordSaleForAppointment`, the
 * same code as a live payment, so this cannot book a figure the app would not.
 *
 * Run after migration 0124, on every environment:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/rederive-sales.ts`
 * (`npm run db:rederive-sales`). Prints before/after totals per clinic: the TOTAL
 * collected revenue only grows by what non-completed visits had already collected.
 */
import { sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { recordSaleForAppointment } from "@/core/sales/ledger";

async function main() {
  await unscoped("one-time re-derive of the sales ledger across every clinic", async () => {
    const before = await db.execute(sql`select clinic_id::text c, coalesce(sum(net_amount),0)::int n, count(*)::int rows from sales group by clinic_id`);
    const visits = await db.execute(sql`
      select a.id::text id, a.clinic_id::text c from appointments a
      where a.deleted_at is null
        and (a.amount_collected > 0
             or exists (select 1 from sales s where s.appointment_id = a.id)
             or exists (select 1 from patient_payments p where p.appointment_id = a.id and p.deleted_at is null))
      union
      select s.appointment_id::text, s.clinic_id::text from sales s
      join appointments a on a.id = s.appointment_id where a.deleted_at is not null`);
    let n = 0;
    for (const v of visits.rows as { id: string; c: string }[]) {
      await recordSaleForAppointment(v.c, v.id);
      n++;
    }
    const after = await db.execute(sql`select clinic_id::text c, coalesce(sum(net_amount),0)::int n, count(*)::int rows from sales group by clinic_id`);
    const b = new Map((before.rows as { c: string; n: number; rows: number }[]).map((r) => [r.c, r]));
    console.log(`Re-derived ${n} visits.`);
    for (const r of after.rows as { c: string; n: number; rows: number }[]) {
      const was = b.get(r.c);
      console.log(`  clinic ${r.c.slice(0, 8)}: revenue ${was?.n ?? 0} → ${r.n}, rows ${was?.rows ?? 0} → ${r.rows}`);
    }
  });
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
