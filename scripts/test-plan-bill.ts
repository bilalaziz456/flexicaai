/**
 * Treatment-plan money (pure, no DB): item offer → item discount → overall discount,
 * the overall discount's allocation back to items, and — the property that matters —
 * that a visit booked from the plan bills exactly what the plan promised for those
 * items. Run: `tsx scripts/test-plan-bill.ts` (chained in `npm run test:unit`).
 */
import { computeBill } from "../src/core/appointments/fee";
import { computePlanBill, discountByLabel, splitForVisit, type PlanItemInput } from "../src/core/patients/plan-bill";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

const item = (p: Partial<PlanItemInput> & { unitPrice: number }): PlanItemInput => ({
  quantity: 1, offerType: "amount", offerValue: 0, discountType: "amount", discountValue: 0, ...p,
});

console.log("One item:");
const one = computePlanBill([item({ unitPrice: 10000, offerType: "percent", offerValue: 10, discountType: "percent", discountValue: 10 })], { type: "amount", value: 0 });
check("offer first, then the item discount on what is left", [one.items[0].offer, one.items[0].discount, one.items[0].net], [1000, 900, 8100]);
check("the plan discount excludes the clinic's offer", one.planDiscount, 900);

console.log("\nOverall discount:");
const plan = computePlanBill(
  [item({ unitPrice: 3333 }), item({ unitPrice: 3333 }), item({ unitPrice: 3334 }), item({ unitPrice: 5000, cancelled: true })],
  { type: "amount", value: 1000 },
);
check("it comes off the subtotal", [plan.subtotal, plan.overallDiscount, plan.total], [10000, 1000, 9000]);
check("its allocation sums to it exactly", plan.items.reduce((s, i) => s + i.overallShare, 0), 1000);
check("a cancelled item costs nothing and takes no share", [plan.items[3].net, plan.items[3].overallShare], [0, 0]);
const big = computePlanBill([item({ unitPrice: 500 })], { type: "amount", value: 9999 });
check("a flat discount larger than the plan is clamped", [big.overallDiscount, big.total], [500, 0]);

console.log("\nA visit booked from the plan bills what the plan promised:");
// Random plans; book a random subset; the visit's bill (offer as the line discount,
// the plan discount as the appointment discount) must equal the plan's figures.
let seed = 7;
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
let mismatches = 0;
for (let t = 0; t < 300; t++) {
  const items = Array.from({ length: 1 + rnd(5) }, () =>
    item({
      unitPrice: 100 * (1 + rnd(200)),
      quantity: 1 + rnd(3),
      offerType: rnd(2) ? "percent" : "amount",
      offerValue: rnd(3) === 0 ? 0 : rnd(2) ? rnd(40) : 50 * rnd(20),
      discountType: rnd(2) ? "percent" : "amount",
      discountValue: rnd(2) ? rnd(30) : 100 * rnd(10),
    }),
  );
  const b = computePlanBill(items, rnd(2) ? { type: "percent", value: rnd(25) } : { type: "amount", value: 100 * rnd(30) });
  const booked = items.map((_, i) => i).filter(() => rnd(2) === 1);
  const lines = booked.map((i) => ({ unitPrice: items[i].unitPrice, quantity: items[i].quantity, discountType: items[i].offerType, discountValue: items[i].offerValue }));
  const discount = booked.reduce((s, i) => s + b.items[i].planDiscount, 0);
  const visit = computeBill(0, lines, "amount", discount);
  const promised = booked.reduce((s, i) => s + b.items[i].net - b.items[i].overallShare, 0);
  if (visit.net !== promised) mismatches++;
}
check("300 random plans and bookings, no rupee lost or gained", mismatches, 0);

console.log("\nWho gives it:");
check("doctor", discountByLabel("doctor", "Dr. Sana Ali", "Smile Dental"), "Dr. Sana Ali");
check("clinic", discountByLabel("clinic", "Dr. Sana Ali", "Smile Dental"), "Smile Dental");
check("both", discountByLabel("split", "Dr. Sana Ali", "Smile Dental"), "Dr. Sana Ali and Smile Dental");
check("no doctor chosen", discountByLabel("doctor", null, "Smile Dental"), "the doctor");
check("a % split carries as it is", splitForVisit({ type: "percent", value: 40 }, 5000, 1000), { type: "percent", value: 40 });
check("a flat split carries in proportion", splitForVisit({ type: "amount", value: 2000 }, 5000, 1000), { type: "amount", value: 400 });

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
