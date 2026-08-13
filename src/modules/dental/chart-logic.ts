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
import { isRootTreated } from "@/modules/dental/tooth-status";

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
  /** Root-treated before/after. Tracked separately because it is its own axis. */
  endoFrom: boolean;
  endoTo: boolean;
};

/**
 * The teeth whose STATUS or ROOT-TREATED state changed between two chart states —
 * for the visit timeline ("what this visit changed"). Surface/note-only edits are
 * ignored for the summary.
 *
 * Endodontic state is included because it does not imply a status change: a root
 * canal on a tooth that keeps its existing restoration moves no status at all, and
 * on a status-only diff the visit that did the root canal would report having
 * changed nothing.
 */
export function diffTeeth(before: ChartTeeth, after: ChartTeeth): ToothChange[] {
  const teeth = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: ToothChange[] = [];
  for (const t of teeth) {
    const b = before[t]?.status ?? null;
    const a = after[t]?.status ?? null;
    const eb = isRootTreated(before[t]);
    const ea = isRootTreated(after[t]);
    if (b !== a || eb !== ea) changes.push({ tooth: t, from: b, to: a, endoFrom: eb, endoTo: ea });
  }
  return changes.sort((x, y) => x.tooth.localeCompare(y.tooth));
}
