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
import type { ChartTeeth, ChartTooth, ToothStatus } from "@/modules/dental/db/schema";
import { isRootTreated } from "@/modules/dental/tooth-status";

/** A record as far as the fold cares — its snapshot + ordering key. */
export type ChartFrame = {
  chartAfter?: ChartTeeth | null;
  isBaseline?: boolean;
  /** Chronological key (baseline first, then visit/created date ascending). */
  at: number;
  /** The record's own id, so a history entry can name the frame to amend. */
  id?: string;
  /** The visit this frame came from. Null on the baseline and on a correction. */
  visitId?: string | null;
};

/**
 * One frame's effect on ONE tooth — an entry in that tooth's own history.
 *
 * The chart records what a tooth IS. This is how it got there: filled at one visit,
 * root-treated at the next, crowned at the one after. All of it was already in the
 * `chart_after` frames, but organised by visit, so reading a single tooth's story
 * meant opening every visit in turn.
 */
export type ToothHistoryEntry = {
  /** The frame that made this change — what an amendment reverts. */
  recordId?: string;
  visitId?: string | null;
  isBaseline: boolean;
  at: number;
  /** State before this frame, and after it. Null = no entry (i.e. sound). */
  before: ChartTooth | null;
  after: ChartTooth | null;
  /**
   * A frame belonging to no visit and not the baseline, which is what an amendment
   * writes. Structural rather than a flag, so it needed no migration.
   */
  isCorrection: boolean;
};

/**
 * Every recorded change to ONE tooth, oldest first.
 *
 * Only frames that actually moved this tooth are returned, so a patient with thirty
 * visits and one filling on 18 yields one entry for 18. Comparison is on the whole
 * tooth — status, root canal, surfaces and note — because a note added at a later
 * visit is part of that tooth's story even though no status moved.
 */
export function toothHistory(frames: ChartFrame[], tooth: string): ToothHistoryEntry[] {
  const out: ToothHistoryEntry[] = [];
  let before: ChartTooth | null = null;
  for (const f of orderFrames(frames)) {
    if (!f.chartAfter || !(tooth in f.chartAfter)) continue;
    const after = f.chartAfter[tooth] ?? null;
    if (sameTooth(before, after)) continue;
    out.push({
      recordId: f.id,
      visitId: f.visitId ?? null,
      isBaseline: !!f.isBaseline,
      at: f.at,
      before,
      after,
      isCorrection: !f.isBaseline && !f.visitId,
    });
    before = after;
  }
  return out;
}

/** Whole-tooth equality — every field a clinician would consider part of the record. */
function sameTooth(a: ChartTooth | null, b: ChartTooth | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.status === b.status &&
    isRootTreated(a) === isRootTreated(b) &&
    (a.note ?? "") === (b.note ?? "") &&
    [...(a.surfaces ?? [])].sort().join("") === [...(b.surfaces ?? [])].sort().join("")
  );
}

/**
 * What one tooth would be if a given record had never been written — the state an
 * amendment restores. Null means it would have no entry, i.e. sound.
 *
 * This re-folds every OTHER frame rather than rewinding to the state just before the
 * mistaken one, and the difference matters. Frames are snapshots, not deltas: on a
 * tooth filled, then root-treated, then crowned, rewinding the FILLING would throw
 * away the root canal and the crown along with it, because they came later. Folding
 * without that one record instead leaves the tooth crowned and root-treated, which is
 * what undoing a single mistaken entry should mean. Undoing the newest entry gives
 * the same answer either way, which is the common case.
 */
export function toothStateWithout(
  frames: ChartFrame[],
  tooth: string,
  recordId: string,
): ChartTooth | null {
  const rebuilt = reduceChart(frames.filter((f) => f.id !== recordId));
  return rebuilt[tooth] ?? null;
}

/** Order frames for folding: baseline first, then oldest→newest. */
export function orderFrames<T extends ChartFrame>(frames: T[]): T[] {
  return [...frames].sort((a, b) => {
    if (a.isBaseline && !b.isBaseline) return -1;
    if (b.isBaseline && !a.isBaseline) return 1;
    return a.at - b.at;
  });
}

/**
 * Nothing worth an entry: sound, unmarked, unnoted, not root-treated. The editor
 * already refuses to store such a tooth, and the fold now drops it for the same
 * reason — it is also how a frame says "this tooth went back to sound", which is
 * what an amendment writes when it reverts the very first entry a tooth ever had.
 */
export function isBlankTooth(t: ChartTooth | null | undefined): boolean {
  return !t || (t.status === "sound" && !t.surfaces?.length && !t.note && !t.endo);
}

/** Fold ordered record snapshots into the current living chart. */
export function reduceChart(frames: ChartFrame[]): ChartTeeth {
  const chart: ChartTeeth = {};
  for (const f of orderFrames(frames)) {
    if (!f.chartAfter) continue;
    for (const [tooth, state] of Object.entries(f.chartAfter)) {
      if (isBlankTooth(state)) delete chart[tooth];
      else chart[tooth] = state;
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
