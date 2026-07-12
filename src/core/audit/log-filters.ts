const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Local-midnight Date from a `YYYY-MM-DD` string. */
function dateFromStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Parses the activity-log URL filters (`from`/`to`/`actor`). Unlike the
 * appointment list, dates DON'T default (logs are browsed as history) — an
 * empty range means "no date constraint". Returns the half-open interval
 * `[start, endExclusive)` (either bound may be null) and the actor name.
 */
export function parseLogFilters(sp: {
  from?: string;
  to?: string;
  actor?: string;
}): {
  fromStr: string;
  toStr: string;
  actor: string;
  start: Date | null;
  endExclusive: Date | null;
} {
  let fromStr = sp.from && YMD.test(sp.from) ? sp.from : "";
  let toStr = sp.to && YMD.test(sp.to) ? sp.to : "";
  if (fromStr && toStr && fromStr > toStr) [fromStr, toStr] = [toStr, fromStr];
  const actor = (sp.actor ?? "").trim();

  const start = fromStr ? dateFromStr(fromStr) : null;
  let endExclusive: Date | null = null;
  if (toStr) {
    endExclusive = dateFromStr(toStr);
    endExclusive.setDate(endExclusive.getDate() + 1);
  }
  return { fromStr, toStr, actor, start, endExclusive };
}
