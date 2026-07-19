/**
 * Odontogram fold logic — PURE (no DB / no server-only), so it unit-tests cleanly
 * and the same reduction runs on the server. The living `dental_charts` is the
 * reduction of the ordered `dental_records.chart_after` frames (baseline first,
 * then oldest→newest); this file is that reduction + the per-visit diff.
 *
 * Model: each record's `chart_after` is the full (or partial) per-tooth state after
 * that record. Reducing folds them per-tooth in order — so the current chart = the
 * accumulation of every record, and the latest full snapshot wins tooth-by-tooth.
 * That makes "rebuild from history == stored chart" trivially true, and re-folding
 * after an edit/void is just re-running this over the live records.
 */
import type { ChartTeeth, ToothStatus } from "@/modules/dental/db/schema";

/** A record as far as the fold cares — its snapshot + ordering key. */
export type ChartFrame = {
  chartAfter?: ChartTeeth | null;
  isBaseline?: boolean;
  /** Chronological key (baseline first, then visit/created date ascending). */
  at: number;
};

/** Order frames for folding: baseline first, then oldest→newest. */
export function orderFrames<T extends ChartFrame>(frames: T[]): T[] {
  return [...frames].sort((a, b) => {
    if (a.isBaseline && !b.isBaseline) return -1;
    if (b.isBaseline && !a.isBaseline) return 1;
    return a.at - b.at;
  });
}

/** Fold ordered record snapshots into the current living chart. */
export function reduceChart(frames: ChartFrame[]): ChartTeeth {
  const chart: ChartTeeth = {};
  for (const f of orderFrames(frames)) {
    if (!f.chartAfter) continue;
    for (const [tooth, state] of Object.entries(f.chartAfter)) {
      chart[tooth] = state;
    }
  }
  return chart;
}

export type ToothChange = {
  tooth: string;
  from: ToothStatus | null;
  to: ToothStatus | null;
};

/**
 * The teeth whose STATUS changed between two chart states — for the visit timeline
 * ("what this visit changed"). Surface/note-only edits are ignored for the summary.
 */
export function diffTeeth(before: ChartTeeth, after: ChartTeeth): ToothChange[] {
  const teeth = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: ToothChange[] = [];
  for (const t of teeth) {
    const b = before[t]?.status ?? null;
    const a = after[t]?.status ?? null;
    if (b !== a) changes.push({ tooth: t, from: b, to: a });
  }
  return changes.sort((x, y) => x.tooth.localeCompare(y.tooth));
}
