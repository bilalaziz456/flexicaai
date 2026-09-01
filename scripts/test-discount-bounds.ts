/**
 * A percent discount is capped at 100 (D-17 / ADR-021) — pure rules + the database.
 *
 * WHY THIS FIELD GETS ITS OWN TEST: `discount_value` unbounded is what overflowed
 * int4 inside the SQL bill, making Postgres THROW where TypeScript quietly clamped —
 * one mistyped percentage would 500 the appointments list, receivables, invoices and
 * the dashboard for that whole clinic until somebody edited the row. Four layers now
 * stop it (form clamp → zod refine → core write clamp → DB CHECK) and this asserts
 * the two that can be tested without a browser, plus the constraint itself.
 *
 * Run: `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-discount-bounds.ts`
 */
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { appointments, clinics, patients } from "@/core/db/schema";
import { unscoped } from "@/core/db/tenant-guard";
import type { DiscountTypeCode } from "@/core/db/vocabulary-seed";
import {
  MAX_DISCOUNT_PERCENT,
  clampDiscountValue,
  computeFee,
  discountError,
  isValidDiscount,
} from "@/core/appointments/fee";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

console.log("The rule (pure):");
{
  check("0% is valid", isValidDiscount("percent", 0), true);
  check("100% is valid — the whole thing, free", isValidDiscount("percent", 100), true);
  check("101% is not", isValidDiscount("percent", 101), false);
  check("99999% is not", isValidDiscount("percent", 99999), false);
  check("negative is not", isValidDiscount("percent", -1), false);
  // A flat amount has no ceiling: the bill it applies to isn't known here, and
  // `computeFee` clamps it to the bill anyway — a large write-off is legitimate.
  check("a flat amount of 99999 IS valid", isValidDiscount("amount", 99999), true);
  check("a negative amount is not", isValidDiscount("amount", -5), false);

  check("the message names the ceiling", discountError("percent", 150), `A percentage discount can't be more than ${MAX_DISCOUNT_PERCENT}%.`);
  check("…and says nothing when fine", discountError("percent", 20), null);
  check("…and catches a negative amount", discountError("amount", -1), "Discount can't be negative.");
}

console.log("\nClamping (for paths where rejecting a value would be unhelpful):");
{
  check("a percentage is capped", clampDiscountValue("percent", 99999), 100);
  check("a valid percentage passes through", clampDiscountValue("percent", 20), 20);
  check("an amount is not capped", clampDiscountValue("amount", 99999), 99999);
  check("junk becomes 0", clampDiscountValue("percent", Number.NaN), 0);
  check("negatives become 0", clampDiscountValue("amount", -50), 0);
  check("fractions round", clampDiscountValue("amount", 12.6), 13);
}

console.log("\nThe maths agrees the cap loses nothing:");
{
  // Anything at or above 100% was already "free" — so capping changes no figure,
  // it only stops a meaningless number being stored.
  check("100% of 4000 → free", computeFee(4000, "percent", 100).net, 0);
  check("99999% of 4000 → also free", computeFee(4000, "percent", 99999).net, 0);
}

async function main() {
  console.log("\nThe database refuses it too (the layer that can't be bypassed):");
  const uniq = Date.now();
  const clinicId = (
    await db.insert(clinics).values({ name: `bounds ${uniq}` }).returning({ id: clinics.id })
  )[0].id;
  const patientId = (
    await db.insert(patients).values({ clinicId, fullName: "Bounds" }).returning({ id: patients.id })
  )[0].id;

  const insert = (discountType: DiscountTypeCode, discountValue: number) =>
    db.insert(appointments).values({
      clinicId,
      patientId,
      module: "dental",
      scheduledAt: new Date(),
      discountType,
      discountValue,
    });

  const ok = await insert("percent", 100).then(() => true).catch(() => false);
  check("100% is accepted", ok, true);

  // The CHECK is the backstop for any writer that skipped the app-level rules.
  const rejected = await insert("percent", 150).then(() => false).catch(() => true);
  check("150% is REJECTED by the constraint", rejected, true);

  const flatOk = await insert("amount", 99999).then(() => true).catch(() => false);
  check("a large flat amount is still accepted", flatOk, true);

  await unscoped("test cleanup", async () => {
    await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
    await db.delete(patients).where(eq(patients.clinicId, clinicId));
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
