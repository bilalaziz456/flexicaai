/**
 * Dates with a time, as the clinic reads them: "17 Oct 2026, 12:55 AM" — a 12-hour
 * clock with AM/PM (owner's call, 2026-10-18). `en-GB` alone prints "00:55", which
 * the desk misreads; `en-US` would put the month first. PURE, so server pages and
 * client components share it.
 */
export function formatTime12h(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** "17 Oct 2026, 12:55 AM" — or "17 Oct, 12:55 AM" with `year: false`. */
export function formatDateTime12h(d: Date, opts: { year?: boolean } = {}): string {
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    ...(opts.year === false ? {} : { year: "numeric" }),
  });
  return `${date}, ${formatTime12h(d)}`;
}
