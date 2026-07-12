const YMD = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");

/** Local-midnight Date from a `YYYY-MM-DD` string. */
function dateFromStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parses the activity-log URL filters. The date range DEFAULTS to today (the log
 * page opens on today's activity); `actor` narrows to one employee and `clinic`
 * (super-admin only) to one clinic. Returns the half-open day interval
 * `[start, endExclusive)`.
 */
export function parseLogFilters(sp: {
  from?: string;
  to?: string;
  actor?: string;
  clinic?: string;
}): {
  fromStr: string;
  toStr: string;
  today: string;
  actor: string;
  clinic: string;
  start: Date;
  endExclusive: Date;
} {
  const today = todayStr();
  let fromStr = sp.from && YMD.test(sp.from) ? sp.from : today;
  let toStr = sp.to && YMD.test(sp.to) ? sp.to : today;
  if (fromStr > toStr) [fromStr, toStr] = [toStr, fromStr];
  const actor = (sp.actor ?? "").trim();
  const clinic = (sp.clinic ?? "").trim();

  const start = dateFromStr(fromStr);
  const endExclusive = dateFromStr(toStr);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { fromStr, toStr, today, actor, clinic, start, endExclusive };
}
