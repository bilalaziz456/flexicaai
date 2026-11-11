/**
 * The clinic's default discount bearer (owner, 2026-11-11), and a split's doctor part
 * following the doctor's share. Pure — no database.
 *
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-discount-default.ts`
 */
import {
  consultationSharePart,
  discountDefaultOf,
  discountDefaultSchema,
  procedureSharePart,
  weightedSharePart,
} from "../src/core/clinics/discount-default";
import { withSharePart, NO_LINE_DISC } from "../src/app/clinic/appointments/line-discount";

let failures = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("The setting:");
ok("a clinic that never set it bears discounts itself", discountDefaultOf(null) === "clinic");
ok("doctor reads back as doctor", discountDefaultOf({ defaultDiscountBorneBy: "doctor" }) === "doctor");
ok("an offer's 'In proportion' never becomes a default", discountDefaultOf({ defaultDiscountBorneBy: "proportional" }) === "clinic");
ok("clinic, doctor and split are accepted", ["clinic", "doctor", "split"].every((b) => discountDefaultSchema.safeParse({ borneBy: b }).success));
ok("proportional is refused", !discountDefaultSchema.safeParse({ borneBy: "proportional" }).success);

console.log("\nThe doctor's part follows their share:");
const rates = {
  drA: { consultationPct: 30, defaultProcedurePct: 20, overrides: { crown: 40, cleaning: 0 } },
};
ok("20% default share → bears 20%", procedureSharePart(rates, "drA", "filling") === 20);
ok("40% share on a crown → bears 40%", procedureSharePart(rates, "drA", "crown") === 40);
ok("0% share on cleaning → bears 0%", procedureSharePart(rates, "drA", "cleaning") === 0);
ok("consultation follows the consultation share", consultationSharePart(rates, "drA") === 30);
ok("no doctor → bears 0%", procedureSharePart(rates, null, "crown") === 0 && consultationSharePart(rates, "") === 0);
ok("unknown doctor → bears 0%", procedureSharePart(rates, "drZ", "crown") === 0);
ok(
  "whole visit: Rs 10,000 crown at 40% + Rs 2,000 room at 0% → 33%",
  weightedSharePart([{ amount: 10000, pct: 40 }, { amount: 2000, pct: 0 }]) === 33,
);
ok("whole visit with nothing billed → 0%", weightedSharePart([]) === 0);

console.log("\nOn a line:");
const auto = { ...NO_LINE_DISC, value: "500", borneBy: "split" as const, splitAuto: true };
ok("an automatic split takes the share", withSharePart(auto, 40).splitValue === "40");
ok("…as a percentage", withSharePart({ ...auto, splitType: "amount" }, 40).splitType === "percent");
ok("a typed part is kept", withSharePart({ ...auto, splitAuto: false, splitValue: "25" }, 40).splitValue === "25");
ok("shares not known → left as typed", withSharePart(auto, null).splitValue === "");
ok("not a split → untouched", withSharePart({ ...auto, borneBy: "doctor" }, 40).splitValue === "");

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
