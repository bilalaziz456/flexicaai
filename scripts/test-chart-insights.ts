/**
 * Regression test for CHART INSIGHTS (`core/ui/charts/insights.ts`).
 *
 * These produce the one-line observation under a figure, and a clinic owner reads
 * that line as fact. So the property under test is not "does it say something" but
 * "does it stay SILENT whenever the data does not support the sentence" — below the
 * minimum sample, without a baseline, and (the case found in the live company P&L)
 * when the movement is too small to see in the chart the sentence sits under.
 *
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-chart-insights.ts`
 */
import {
  comparisonInsight,
  concentrationInsight,
  latestVsAverageInsight,
  pickInsight,
  profitCrossingInsight,
  streakInsight,
} from "@/core/ui/charts/insights";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}
const textOf = (i: { text: string } | null) => i?.text ?? null;
const toneOf = (i: { tone: string } | null) => i?.tone ?? null;

console.log("\nStreaks — a run has to be real, and it has to be the CURRENT one");
check("too few points to have a run", streakInsight([1, 2], { noun: "Revenue" }), null);
check(
  "three consecutive rises",
  textOf(streakInsight([5, 6, 7, 8], { noun: "Revenue", unit: "month" })),
  "Revenue has risen for 3 consecutive months.",
);
check(
  "three consecutive falls read as bad",
  toneOf(streakInsight([9, 7, 5, 3], { noun: "Revenue" })),
  "bad",
);
// The run is measured from the END; an old streak that has since broken is not news.
check("a broken streak says nothing", streakInsight([1, 2, 3, 4, 2], { noun: "Revenue" }), null);
check("a flat pair breaks the run", streakInsight([1, 2, 3, 3], { noun: "Revenue" }), null);

console.log("\nLatest vs average — only when the gap is worth a sentence");
check("needs four points", latestVsAverageInsight([1, 2, 10], { noun: "Revenue" }), null);
check(
  "a 3% wobble is not news",
  latestVsAverageInsight([100, 100, 100, 103], { noun: "Revenue" }),
  null,
);
check(
  "a real jump is",
  textOf(latestVsAverageInsight([100, 100, 100, 200], { noun: "revenue" })),
  "The latest revenue is 100% above the period average.",
);
check(
  "below average, where higher is better, reads bad",
  toneOf(latestVsAverageInsight([100, 100, 100, 40], { noun: "revenue" })),
  "bad",
);
check("an average of zero has nothing to compare", latestVsAverageInsight([0, 0, 0, 5]), null);

console.log("\nConcentration — only when the total really does lean on one thing");
check(
  "one contributor is not a concentration",
  concentrationInsight([{ label: "A", value: 10 }], { noun: "revenue" }),
  null,
);
check(
  "an even split says nothing",
  concentrationInsight(
    [
      { label: "A", value: 10 },
      { label: "B", value: 10 },
      { label: "C", value: 10 },
    ],
    { noun: "revenue" },
  ),
  null,
);
check(
  "a dominant contributor does",
  textOf(
    concentrationInsight(
      [
        { label: "Dr Rana", value: 70 },
        { label: "Dr Shah", value: 20 },
        { label: "Dr Karim", value: 10 },
      ],
      { noun: "revenue" },
    ),
  ),
  "Dr Rana accounts for 70% of revenue.",
);

console.log("\nProfit crossings — and the materiality rule that came from a real page");
check(
  "a real fall into loss",
  textOf(profitCrossingInsight([30000, 31000, -12000], { unit: "month" })),
  "This month closed at a loss after a profitable one.",
);
check(
  "a real return to profit",
  textOf(profitCrossingInsight([-12000, 31000], { unit: "month" })),
  "Returned to profit this month after a loss.",
);
// THE CASE THIS RULE EXISTS FOR: the live company P&L ended a month at −126 against
// an axis running to 40,000. True, and invisible in the chart above the sentence.
check(
  "a −126 'loss' on a 40k scale stays silent",
  profitCrossingInsight([14923, 30857, 31863, -126], { unit: "month" }),
  null,
);
check(
  "three losses, all immaterial, stay silent",
  profitCrossingInsight([40000, -5, -6, -7], { unit: "month" }),
  null,
);
check(
  "three real losses do not",
  textOf(profitCrossingInsight([-9000, -8000, -7000], { unit: "month" })),
  "The last three months all closed at a loss.",
);
check("a single point cannot cross anything", profitCrossingInsight([-500]), null);

console.log("\nComparison — refuses an absent baseline");
check(
  "no baseline",
  comparisonInsight(500, 0, { noun: "Revenue", windowLabel: "last month" }),
  null,
);
check(
  "below the threshold",
  comparisonInsight(102, 100, { noun: "Revenue", windowLabel: "last month" }),
  null,
);
check(
  "a real move",
  textOf(comparisonInsight(118, 100, { noun: "Revenue", windowLabel: "last month" })),
  "Revenue is 18.0% higher than last month.",
);
check(
  "rising expenses read bad when higher is worse",
  toneOf(
    comparisonInsight(150, 100, {
      noun: "Expenses",
      windowLabel: "last month",
      higherIsBetter: false,
    }),
  ),
  "bad",
);

console.log("\npickInsight takes the first that has something to say");
check("skips the nulls", textOf(pickInsight(null, null, { text: "third", tone: "good" })), "third");
check("all silent → silent", pickInsight(null, null), null);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
