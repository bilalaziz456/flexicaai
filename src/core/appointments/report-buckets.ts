import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { SERVER_TZ } from "@/core/lib/server-tz";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
} from "@/core/sales/report";

/**
 * Time bucketing shared by the appointments and procedures reports.
 *
 * The database groups by the SERVER's local hour (for "today") or day (anything
 * longer) — the finest grain either report shows — and these rows are folded into the
 * range's week / month buckets in TypeScript with the same `startOfBucket` the Sales
 * report uses, so the two reports and Sales agree on what a "week" is. Grouping at the
 * display grain in SQL bounds the result by the LENGTH of the range, not by how busy
 * the clinic is (ADR-025).
 */
export function timeKeySql(column: SQL | unknown, range: ResolvedRange): SQL<string> {
  // `cast(… as text)`: Postgres cannot infer a bare parameter's type in AT TIME ZONE.
  // SERVER_TZ is an IANA name from Intl, never user input.
  const fmt = range.granularity === "hour" ? `YYYY-MM-DD"T"HH24` : "YYYY-MM-DD";
  return sql<string>`to_char(${column} at time zone cast(${SERVER_TZ} as text), ${fmt})`;
}

function parseKey(key: string): Date {
  const [d, h] = key.split("T");
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day, h ? Number(h) : 0);
}

/** Every bucket in the range, in order, with `value` summed from the keyed rows. */
export function foldBuckets(
  range: ResolvedRange,
  rows: { key: string; value: number }[],
): { label: string; value: number }[] {
  const g = range.granularity;
  const sums = new Map<number, number>();
  for (const r of rows) {
    const b = startOfBucket(parseKey(r.key), g).getTime();
    sums.set(b, (sums.get(b) ?? 0) + Number(r.value));
  }
  const out: { label: string; value: number }[] = [];
  for (let b = startOfBucket(range.start, g); b < range.end; b = nextBucket(b, g)) {
    out.push({ label: bucketLabel(b, g), value: sums.get(b.getTime()) ?? 0 });
  }
  return out;
}
