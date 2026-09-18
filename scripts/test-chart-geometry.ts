/**
 * Regression test for CHART GEOMETRY (`core/ui/charts/geometry.ts`).
 *
 * The property that matters is NO OVERSHOOT. Every chart in the app draws a smooth
 * curve through its points, and the obvious way to smooth a line — Catmull-Rom, or a
 * fixed-tension bezier — swings past the data between a low point and a high one. On
 * money that is not cosmetic: it draws revenue the clinic never took, and after a zero
 * day it dips BELOW zero, which on the P&L chart paints a loss that did not happen.
 *
 * So this samples the emitted bezier densely and asserts the curve never leaves the
 * range of the points it connects — the guarantee monotone cubic (Fritsch-Carlson)
 * gives and the naive spline does not.
 *
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-chart-geometry.ts`
 */
import {
  closeToBaseline,
  labelStride,
  money,
  niceCeil,
  niceScale,
  percentChange,
  shortNum,
  smoothPath,
  ticksFor,
  type Pt,
} from "@/core/ui/charts/geometry";

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
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

/** Cubic bezier value at t. */
const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** Walk the emitted path and report the extreme y the CURVE actually reaches. */
function curveRange(path: string): { min: number; max: number } {
  const nums = (s: string) => s.trim().split(/[ ,]+/).map(Number);
  const segs = path.split(/(?=[MC])/);
  let cx = 0;
  let cy = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const seg of segs) {
    const kind = seg[0];
    const v = nums(seg.slice(1));
    if (kind === "M") {
      [cx, cy] = v;
      min = Math.min(min, cy);
      max = Math.max(max, cy);
    } else if (kind === "C") {
      const [x1, y1, x2, y2, x, y] = v;
      for (let i = 0; i <= 40; i++) {
        const yy = bez(cy, y1, y2, y, i / 40);
        min = Math.min(min, yy);
        max = Math.max(max, yy);
      }
      cx = x;
      cy = y;
    }
  }
  void cx;
  return { min, max };
}

console.log("\nThe smooth curve never leaves the data's own range");
const cases: [string, number[]][] = [
  ["a spike between two flats", [50, 50, 10, 50, 50]],
  ["a zero day between busy ones", [10, 90, 0, 90, 10]],
  ["a step up", [80, 80, 80, 20, 20, 20]],
  ["monotonic climb", [90, 70, 55, 30, 10]],
  ["saw tooth", [10, 90, 10, 90, 10, 90]],
  ["all equal", [40, 40, 40, 40]],
];
for (const [name, ys] of cases) {
  const pts: Pt[] = ys.map((y, i) => ({ x: i * 25, y }));
  const { min, max } = curveRange(smoothPath(pts));
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  // 0.02 tolerance: the path string is rounded to 2dp when emitted.
  ok(
    `${name} stays within [${lo}, ${hi}]`,
    min >= lo - 0.02 && max <= hi + 0.02,
    `curve reached [${min.toFixed(2)}, ${max.toFixed(2)}]`,
  );
}

console.log("\nDegenerate inputs do not produce a broken path");
check("no points → empty", smoothPath([]), "");
check("one point → a move", smoothPath([{ x: 3, y: 4 }]), "M3,4");
check("two points → a straight line", smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }]), "M0,0 L10,5");
ok("three points curve", smoothPath([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }]).includes("C"));
check("closing an empty path stays empty", closeToBaseline("", [], 10), "");

console.log("\nAxis helpers");
check("niceCeil(0)", niceCeil(0), 1);
check("niceCeil(1)", niceCeil(1), 1);
check("niceCeil(4800)", niceCeil(4800), 5000);
check("niceCeil(12400)", niceCeil(12400), 20000);
check("ticks include zero when the range crosses it", ticksFor(-500, 1500, 4).includes(0), true);
check("ticks span the range", [ticksFor(0, 100, 4)[0], ticksFor(0, 100, 4).at(-1)], [0, 100]);
check("a flat range yields one tick", ticksFor(5, 5), [5]);
check("labels thin out when crowded", labelStride(60, 300) > 1, true);
check("labels do not thin when roomy", labelStride(4, 800), 1);

console.log("\nFormatting");
check("shortNum(940)", shortNum(940), "940");
check("shortNum(48240)", shortNum(48240), "48k");
check("shortNum(1_240_000)", shortNum(1240000), "1.2M");
check("shortNum negative uses a real minus", shortNum(-4800), "−4.8k");
check("money", money(48240), "Rs 48,240");
check("money negative", money(-1200), "−Rs 1,200");

console.log("\nPercentage change refuses to invent a baseline");
check("no previous → null", percentChange(500, 0), null);
check("normal growth", Math.round(percentChange(118, 100) ?? 0), 18);
// A loss shrinking from -100 to -50 is an IMPROVEMENT of 50%, not -50%: the
// denominator is |previous|, so the sign tracks the direction of the change.
check("a shrinking loss reads as positive", Math.round(percentChange(-50, -100) ?? 0), 50);

console.log("\nThe value axis snaps to round numbers, and only lets go of zero when asked");
{
  const anchored = niceScale(515_000, 832_000);
  ok(
    "a level far from zero still starts at zero by default",
    anchored.min === 0,
    `min ${anchored.min}`,
  );
  // The balance chart's zoomed view (`balance-trend.tsx`): drawn from zero, three
  // hundred thousand rupees of movement is a dent along the top of a solid block.
  const zoomed = niceScale(388_000, 911_000, 4, false);
  ok("includeZero:false keeps the axis on the data", zoomed.min > 0, `min ${zoomed.min}`);
  ok(
    "and the bounds are still round numbers that contain the range",
    zoomed.min <= 388_000 && zoomed.max >= 911_000 && zoomed.min % 100_000 === 0,
    `${zoomed.min}…${zoomed.max}`,
  );
  // A range that genuinely crosses zero must keep it whichever way it is called: the
  // P&L baseline has to be a line the axis names.
  ok("a range crossing zero keeps zero as a tick", niceScale(-40_000, 90_000, 4, false).ticks.includes(0));
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
