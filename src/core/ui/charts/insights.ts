/**
 * Chart insights — the one-line observation that sits under a figure.
 *
 * READ THIS BEFORE ADDING ONE. Every function here is ARITHMETIC over the series the
 * chart is already drawing, and each returns `null` unless the data actually supports
 * the sentence. They are deliberately not model output and the UI does not call them
 * AI: a sentence under a revenue figure is read as fact by the person who runs the
 * clinic, and "revenue has risen for three months" has to mean the last three buckets
 * rose — not that something once summarised it that way.
 *
 * Two rules keep them honest:
 *  1. **Observation, never advice.** "Margin improved 3.2 points" is a reading of the
 *     numbers. "You should raise prices" is a business conclusion this has no standing
 *     to reach, and a clinic owner acting on it is our fault.
 *  2. **Silence beats a weak claim.** Below the minimum sample each detector returns
 *     null and the caller renders nothing. A card with no insight is normal.
 *
 * PURE — no React, no DOM. Tested by `scripts/test-chart-insights.ts`.
 */

export type Insight = { text: string; tone: "good" | "bad" | "neutral" };

/** A run of consecutive rises or falls at the END of the series (the current streak). */
export function streakInsight(
  values: readonly number[],
  opts: { noun: string; minRun?: number; unit?: string } = { noun: "Revenue" },
): Insight | null {
  const min = opts.minRun ?? 3;
  const n = values.length;
  if (n < min + 1) return null;

  let dir = 0;
  let run = 0;
  for (let i = n - 1; i > 0; i--) {
    const d = Math.sign(values[i] - values[i - 1]);
    if (d === 0) break;
    if (dir === 0) dir = d;
    else if (d !== dir) break;
    run++;
  }
  if (run < min) return null;

  const period = opts.unit ?? "period";
  return {
    text:
      dir > 0
        ? `${opts.noun} has risen for ${run} consecutive ${period}s.`
        : `${opts.noun} has fallen for ${run} consecutive ${period}s.`,
    tone: dir > 0 ? "good" : "bad",
  };
}

/** How the latest bucket compares with the average of the ones before it. */
export function latestVsAverageInsight(
  values: readonly number[],
  opts: { noun: string; minPct?: number; higherIsBetter?: boolean } = { noun: "Revenue" },
): Insight | null {
  const minPct = opts.minPct ?? 15;
  const higherIsBetter = opts.higherIsBetter ?? true;
  if (values.length < 4) return null;

  const latest = values[values.length - 1];
  const rest = values.slice(0, -1);
  const avg = rest.reduce((a, b) => a + b, 0) / rest.length;
  if (avg === 0) return null;

  const pct = ((latest - avg) / Math.abs(avg)) * 100;
  if (Math.abs(pct) < minPct) return null;

  const up = pct > 0;
  return {
    text: `The latest ${opts.noun.toLowerCase()} is ${Math.abs(Math.round(pct))}% ${
      up ? "above" : "below"
    } the period average.`,
    tone: up === higherIsBetter ? "good" : "bad",
  };
}

/** Whether a total leans on one contributor. Only speaks when it genuinely does. */
export function concentrationInsight(
  parts: readonly { label: string; value: number }[],
  opts: { noun: string; threshold?: number } = { noun: "revenue" },
): Insight | null {
  const threshold = opts.threshold ?? 50;
  const positive = parts.filter((p) => p.value > 0);
  if (positive.length < 2) return null;

  const total = positive.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return null;

  const top = positive.reduce((a, b) => (b.value > a.value ? b : a));
  const share = (top.value / total) * 100;
  if (share < threshold) return null;

  return {
    text: `${top.label} accounts for ${Math.round(share)}% of ${opts.noun}.`,
    tone: "neutral",
  };
}

/**
 * A crossing between profit and loss, reported only when it is the LATEST move —
 * "returned to profit" about something that happened four months ago is noise.
 */
export function profitCrossingInsight(
  values: readonly number[],
  opts: { unit?: string; materialPct?: number } = {},
): Insight | null {
  const n = values.length;
  if (n < 2) return null;
  const last = values[n - 1];
  const prev = values[n - 2];
  const period = opts.unit ?? "period";

  /**
   * MATERIALITY. A crossing is only worth announcing when it is big enough to SEE in
   * the chart the sentence sits under.
   *
   * This was found in the live company P&L: the current month stood at −126 rupees on
   * an axis running to 40,000, so the curve ended flat on the zero line while a red
   * line underneath announced that the period had closed at a loss. Both were correct.
   * The reader is left deciding which of the two to believe, and an observation that
   * loses that argument costs more trust than it ever adds — every other insight on
   * the page now has to be checked too.
   *
   * So: at least 2% of the largest magnitude in the series. Below that, the honest
   * answer is that nothing happened.
   */
  const scale = values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const material = (v: number) => Math.abs(v) >= scale * (opts.materialPct ?? 0.02);

  if (prev < 0 && last >= 0 && material(prev)) {
    return { text: `Returned to profit this ${period} after a loss.`, tone: "good" };
  }
  if (prev >= 0 && last < 0 && material(last)) {
    return { text: `This ${period} closed at a loss after a profitable one.`, tone: "bad" };
  }
  // A sustained state is worth saying only once it IS sustained.
  const tail = values.slice(-3);
  if (n >= 3 && tail.every((v) => v < 0) && tail.some(material)) {
    return { text: `The last three ${period}s all closed at a loss.`, tone: "bad" };
  }
  return null;
}

/** Straight change against a comparison window the caller already has. */
export function comparisonInsight(
  current: number,
  previous: number,
  opts: { noun: string; windowLabel: string; higherIsBetter?: boolean; minPct?: number },
): Insight | null {
  const minPct = opts.minPct ?? 5;
  const higherIsBetter = opts.higherIsBetter ?? true;
  if (previous === 0) return null;

  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < minPct) return null;

  const up = pct > 0;
  return {
    text: `${opts.noun} is ${Math.abs(pct).toFixed(1)}% ${up ? "higher" : "lower"} than ${
      opts.windowLabel
    }.`,
    tone: up === higherIsBetter ? "good" : "bad",
  };
}

/**
 * Picks the single strongest insight for a card. Order is by how much the reader
 * learns, not by how confident each one sounds — and one line is the budget: a stack
 * of observations under a number is a paragraph, and nobody reads it.
 */
export function pickInsight(...candidates: (Insight | null)[]): Insight | null {
  return candidates.find((c): c is Insight => c != null) ?? null;
}
