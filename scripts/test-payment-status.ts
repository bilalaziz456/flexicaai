/**
 * The appointment PAYMENT badge — six derived states (core/billing/payment-status.ts).
 * Pure: no database. Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-payment-status.ts`
 */
import { visitPaymentStatus } from "@/core/billing/payment-status";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} — got ${String(got)}, want ${String(want)}`);
  }
}
const s = (bill: number, collected: number, visitStatus: string, refunded = 0) =>
  visitPaymentStatus({ bill, collected, refunded, visitStatus });

console.log("Before the visit is done:");
check("nothing taken → Not paid", s(3500, 0, "scheduled"), "not_paid");
check("part taken → Advance paid", s(3500, 1000, "confirmed"), "advance_paid");
check("all taken → Paid", s(3500, 3500, "arrived"), "paid");
check("more than the bill → Paid", s(3500, 4000, "scheduled"), "paid");

console.log("\nAfter it is completed:");
check("nothing taken → Not paid", s(3500, 0, "completed"), "not_paid");
check("part taken → Partially paid", s(3500, 2000, "completed"), "partially_paid");
check("all taken → Paid", s(3500, 3500, "completed"), "paid");
check("bill raised after paying → back to Partially paid", s(5000, 3500, "completed"), "partially_paid");

console.log("\nCancelled or no-show:");
check("money still held → Refund due", s(3500, 1000, "cancelled"), "refund_due");
check("no-show with money held → Refund due", s(3500, 3500, "no_show"), "refund_due");
check("all given back → Refunded", s(3500, 0, "cancelled", 1000), "refunded");
check("never paid → no badge", s(3500, 0, "cancelled"), null);

console.log("\nRefunds and free visits:");
check("paid then fully refunded → Refunded", s(3500, 0, "completed", 3500), "refunded");
check("partly refunded, some still held → follows what is held", s(3500, 2500, "completed", 1000), "partially_paid");
check("no bill, nothing taken → no badge", s(0, 0, "scheduled"), null);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
