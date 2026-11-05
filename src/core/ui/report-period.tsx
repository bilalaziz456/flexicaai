/**
 * A report's period, written out for paper and PDF only (`data-pdf-only`). On screen
 * the filter bar already says it; on paper the filter bar is left off, and a report
 * that does not say WHEN it covers is useless to whoever reads it later.
 */
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "8 Oct 2026 – 6 Nov 2026", or a single day. `end` is exclusive, as ranges are here. */
export function formatReportRange(start: Date, end: Date): string {
  const last = new Date(end.getTime() - 1);
  const a = dayFmt.format(start);
  const b = dayFmt.format(last);
  return a === b ? a : `${a} – ${b}`;
}

export function ReportPeriod({
  range,
  extra,
}: {
  /** The range shown, or null for "all time". */
  range: { start: Date; end: Date } | null;
  /** Anything else the filters narrowed to, e.g. "Dr Bushra Nadeem". */
  extra?: string;
}) {
  return (
    <p data-pdf-only="" className="text-sm text-muted-foreground">
      Period:{" "}
      <span className="font-medium text-foreground">{range ? formatReportRange(range.start, range.end) : "All time"}</span>
      {extra ? ` · ${extra}` : ""}
    </p>
  );
}
