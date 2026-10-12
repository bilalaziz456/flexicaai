/**
 * Recurring-expense date stepping (`core/expenses/recurring.ts#nextRunFrom`) for the
 * three intervals — Yearly added 2026-10-13. Pure date math (the module also holds
 * the cron, hence the env file). Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-recurring-dates.ts`
 */
import { nextRunFrom, normalizeRecurrence } from "@/core/expenses/recurring";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} — got ${String(got)}, want ${String(want)}`);
  }
}

console.log("Weekly / Monthly (unchanged):");
check("weekly steps 7 days", nextRunFrom("2026-10-13", "weekly"), "2026-10-20");
check("monthly steps a month", nextRunFrom("2026-10-13", "monthly"), "2026-11-13");
check("monthly clamps 31 Jan to 28 Feb", nextRunFrom("2026-01-31", "monthly"), "2026-02-28");

console.log("\nYearly:");
check("steps a year", nextRunFrom("2026-10-13", "yearly"), "2027-10-13");
check("29 Feb 2028 → 28 Feb 2029 (no 29th)", nextRunFrom("2028-02-29", "yearly"), "2029-02-28");
check("31 Dec rolls to next year's 31 Dec", nextRunFrom("2026-12-31", "yearly"), "2027-12-31");

console.log("\nReading the stored value:");
check("yearly is kept", normalizeRecurrence("yearly"), "yearly");
check("weekly is kept", normalizeRecurrence("weekly"), "weekly");
check("unknown falls back to monthly", normalizeRecurrence("fortnightly"), "monthly");

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
