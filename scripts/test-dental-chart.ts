/**
 * Unit tests for the dental odontogram fold logic (pure, no DB).
 * Run: `npm run test:unit` (chained) or `tsx scripts/test-dental-chart.ts`.
 * Asserts reduceChart (baseline-first fold), orderFrames, and diffTeeth.
 */
import { reduceChart, orderFrames, diffTeeth } from "../src/modules/dental/chart-logic";
import { examStats, computeBop } from "../src/modules/dental/perio-logic";
import { isRootTreated } from "../src/modules/dental/tooth-status";
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
  "diff reports status changes, sorted by tooth",
  diffTeeth({ "16": t("filled") }, { "16": t("root_canal"), "21": t("caries") }),
  [
    { tooth: "16", from: "filled", to: "root_canal", endoFrom: false, endoTo: true },
    { tooth: "21", from: null, to: "caries", endoFrom: false, endoTo: false },
  ],
);

check("diff of identical charts = no changes", diffTeeth({ "16": t("filled") }, { "16": t("filled") }), []);

// Root canal is its own axis. A root canal on a tooth that keeps its restoration
// moves no status, so a status-only diff would report the visit as having changed
// nothing at all.
check(
  "diff catches a root canal that changes no status",
  diffTeeth({ "16": t("crown") }, { "16": { status: "crown", endo: true } }),
  [{ tooth: "16", from: "crown", to: "crown", endoFrom: false, endoTo: true }],
);

check(
  "the legacy root_canal status counts as root-treated",
  diffTeeth({ "16": t("root_canal") }, { "16": { status: "root_canal", endo: true } }),
  [],
);

console.log("\nRoot-treated:");
check("endo flag", isRootTreated({ status: "filled", endo: true }), true);
check("legacy status", isRootTreated({ status: "root_canal" }), true);
check("crown alone is not root-treated", isRootTreated({ status: "crown" }), false);
check("endo survives a crown being charted over it", isRootTreated({ status: "crown", endo: true }), true);
check("no tooth", isRootTreated(undefined), false);

console.log("\nPerio summary:");
{
  // Tooth 16: 6 pockets, 2 bleeding, deepest 6mm, two sites ≥5. Tooth 21: 3 charted.
  const teeth = {
    "16": { pockets: [3, 6, 5, 2, 3, 4], bleeding: [false, true, true, false, false, false] },
    "21": { pockets: [2, 2, 3, null, null, null], bleeding: [false, false, false] },
  } as never;
  const s = examStats(teeth);
  check("BOP% = bleeding/charted sites", s.bop, Math.round((2 / 9) * 100)); // 2 of 9 charted sites
  check("computeBop matches examStats.bop", computeBop(teeth), s.bop);
  check("deepest pocket", s.maxPocket, 6);
  check("sites ≥ 5mm", s.sitesOver5, 2);
  check("charted teeth", s.chartedTeeth, 2);
  check("empty chart → zeros", examStats({} as never), { bop: 0, maxPocket: 0, sitesOver5: 0, chartedTeeth: 0 });
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
