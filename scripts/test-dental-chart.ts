/**
 * Unit tests for the dental odontogram fold logic (pure, no DB).
 * Run: `npm run test:unit` (chained) or `tsx scripts/test-dental-chart.ts`.
 * Asserts reduceChart (baseline-first fold), orderFrames, and diffTeeth.
 */
import { reduceChart, orderFrames, diffTeeth, toothHistory } from "../src/modules/dental/chart-logic";
import { examStats, computeBop } from "../src/modules/dental/perio-logic";
import { autoDentition, isRootTreated } from "../src/modules/dental/tooth-status";
import type { ChartTeeth } from "../src/modules/dental/db/schema";
import type { ChartFrame } from "../src/modules/dental/chart-logic";

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

console.log("\nPer-tooth history:");
{
  // 18 over three visits: filled, then root-treated, then crowned. 26 is touched
  // once and must not appear in 18's history.
  const frames: ChartFrame[] = [
    { id: "b", isBaseline: true, at: 0, chartAfter: { "26": t("caries") } },
    { id: "r1", visitId: "v1", at: 100, chartAfter: { "18": t("filled") } },
    { id: "r2", visitId: "v2", at: 200, chartAfter: { "18": { status: "filled", endo: true } } },
    { id: "r3", visitId: "v3", at: 300, chartAfter: { "18": { status: "crown", endo: true } } },
  ];

  check("history is one entry per real change", toothHistory(frames, "18").length, 3);
  check(
    "history reads oldest first, with the transition",
    toothHistory(frames, "18").map((e) => `${e.before?.status ?? "sound"}→${e.after?.status}${e.after && isRootTreated(e.after) ? "+endo" : ""}`),
    ["sound→filled", "filled→filled+endo", "filled→crown+endo"],
  );
  check("history names the visit that made each change", toothHistory(frames, "18").map((e) => e.visitId), ["v1", "v2", "v3"]);
  check("a tooth touched only by the baseline", toothHistory(frames, "26").map((e) => e.isBaseline), [true]);
  check("an untouched tooth has no history", toothHistory(frames, "11"), []);

  // A frame that re-states the same tooth is not a change and must not appear.
  const repeated: ChartFrame[] = [...frames, { id: "r4", visitId: "v4", at: 400, chartAfter: { "18": { status: "crown", endo: true } } }];
  check("re-stating the same tooth adds no entry", toothHistory(repeated, "18").length, 3);

  // A note added later IS part of the tooth's story even though no status moved.
  const noted: ChartFrame[] = [...frames, { id: "r5", visitId: "v5", at: 500, chartAfter: { "18": { status: "crown", endo: true, note: "check margin" } } }];
  check("a note-only change is recorded", toothHistory(noted, "18").length, 4);

}

console.log("\nRoot-treated:");
check("endo flag", isRootTreated({ status: "filled", endo: true }), true);
check("legacy status", isRootTreated({ status: "root_canal" }), true);
check("crown alone is not root-treated", isRootTreated({ status: "crown" }), false);
check("endo survives a crown being charted over it", isRootTreated({ status: "crown", endo: true }), true);
check("no tooth", isRootTreated(undefined), false);

console.log("\nAutomatic dentition (the mixed → permanent transition):");
check("adult with permanent charted", autoDentition({ "18": t("crown") }), "permanent");
check("toddler with primary only", autoDentition({ "55": t("caries") }), "primary");
check("child in mixed dentition", autoDentition({ "16": t("sealant"), "55": t("caries") }), "mixed");
check("an empty chart is a blank adult form", autoDentition({}), "permanent");

// Shedding retires the dentition on its own — no age check, no manual tidy-up.
check(
  "still mixed while any primary tooth remains",
  autoDentition({ "16": t("sealant"), "55": t("exfoliated"), "54": t("filled") }),
  "mixed",
);
check(
  "once every primary tooth has shed, the chart is permanent",
  autoDentition({ "16": t("sealant"), "55": t("exfoliated"), "54": t("exfoliated") }),
  "permanent",
);
// A missing PERMANENT tooth is a gap a dentist needs to see, so `missing` must NOT
// retire a dentition the way `exfoliated` does.
check("a missing permanent tooth still counts", autoDentition({ "16": t("missing") }), "permanent");
check("a missing primary tooth still counts", autoDentition({ "55": t("missing") }), "primary");

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
