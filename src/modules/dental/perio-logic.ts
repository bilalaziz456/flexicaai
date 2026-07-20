/**
 * Periodontal summary maths — PURE (no DB), so it unit-tests cleanly and the same
 * numbers run on the server. A "site" counts as charted when it has a pocket depth.
 */
import type { PerioTeeth } from "@/modules/dental/db/schema";

/** Bleeding-on-probing % = bleeding sites ÷ charted sites (0 when nothing charted). */
export function computeBop(teeth: PerioTeeth): number {
  return examStats(teeth).bop;
}

/** Whole-mouth summary for one exam — BOP%, deepest pocket, ≥5 mm sites, charted teeth. */
export function examStats(teeth: PerioTeeth): {
  bop: number;
  maxPocket: number;
  sitesOver5: number;
  chartedTeeth: number;
} {
  let sites = 0;
  let bleeding = 0;
  let maxPocket = 0;
  let sitesOver5 = 0;
  let chartedTeeth = 0;
  for (const t of Object.values(teeth)) {
    const pk = t.pockets ?? [];
    const bl = t.bleeding ?? [];
    let charted = false;
    for (let i = 0; i < 6; i++) {
      const p = pk[i];
      if (p == null) continue;
      sites++;
      charted = true;
      if (bl[i]) bleeding++;
      if (p > maxPocket) maxPocket = p;
      if (p >= 5) sitesOver5++;
    }
    if (charted) chartedTeeth++;
  }
  return {
    bop: sites === 0 ? 0 : Math.round((bleeding / sites) * 100),
    maxPocket,
    sitesOver5,
    chartedTeeth,
  };
}
