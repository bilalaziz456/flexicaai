/**
 * Unit tests for the dental odontogram fold logic (pure, no DB).
 * Run: `npm run test:unit` (chained) or `tsx scripts/test-dental-chart.ts`.
 * Asserts reduceChart (baseline-first fold), orderFrames, and diffTeeth.
 */
import { reduceChart, orderFrames, diffTeeth } from "../src/modules/dental/chart-logic";
import type { ChartTeeth } from "../src/modules/dental/db/schema";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

const t = (status: string): ChartTeeth[string] => ({ status: status as never });

console.log("Dental chart fold:");

// Baseline (existing conditions), then a visit that changes tooth 16.
const baseline = { chartAfter: { "16": t("filled"), "26": t("missing") }, isBaseline: true, at: 100 };
const visit1 = { chartAfter: { "16": t("root_canal"), "21": t("caries") }, isBaseline: false, at: 200 };

check(
  "reduce folds baseline first + latest tooth wins",
  reduceChart([visit1, baseline]),
  { "16": t("root_canal"), "26": t("missing"), "21": t("caries") },
);

check(
  "orderFrames: baseline first even with a later `at`",
  orderFrames([{ isBaseline: false, at: 50 }, { isBaseline: true, at: 999 }]).map((f) => f.at),
  [999, 50],
);

check("reduce of nothing = empty chart", reduceChart([]), {});

check(
  "reduce ignores null chartAfter frames",
  reduceChart([baseline, { chartAfter: null, isBaseline: false, at: 300 }]),
  { "16": t("filled"), "26": t("missing") },
);

console.log("\nDental chart diff:");
check(
  "diff reports status changes only, sorted by tooth",
  diffTeeth({ "16": t("filled") }, { "16": t("root_canal"), "21": t("caries") }),
  [
    { tooth: "16", from: "filled", to: "root_canal" },
    { tooth: "21", from: null, to: "caries" },
  ],
);

check("diff of identical charts = no changes", diffTeeth({ "16": t("filled") }, { "16": t("filled") }), []);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
