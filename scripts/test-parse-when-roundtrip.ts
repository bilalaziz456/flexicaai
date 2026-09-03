/**
 * ROUND-TRIP CONTRACT — `formatWhen` writes what `parseWhen` reads (Phase 2 of
 * docs/whatsapp-ai-plan.md). Pure: no database, no network.
 *
 * WHY THIS EXISTS. When something other than the parser works out what a patient
 * meant, it must not act on that reading — it restates the request in `formatWhen`'s
 * format and asks the patient to send it back, so the appointment is always produced
 * by `parseWhen`. That only works if every string `formatWhen` emits is one
 * `parseWhen` reads back identically. Otherwise the clinic is asking patients for a
 * format its own parser rejects, and they cannot get out of the loop.
 *
 * The generated sweep below is the point: 400 days x a spread of times, so the
 * boundaries nobody thinks of — midnight, noon, a year rollover, single-digit
 * everything — are covered by construction rather than by whoever wrote the fixtures
 * remembering them.
 *
 * Run: `tsx scripts/test-parse-when-roundtrip.ts`
 */
import { formatWhen, parseWhen } from "../src/core/appointments/parse-when";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
  }
}

/** What a round trip should recover: the same calendar date and clock time. */
const parts = (d: Date) => ({
  y: d.getFullYear(),
  m: d.getMonth() + 1,
  d: d.getDate(),
  h: d.getHours(),
  min: d.getMinutes(),
});

const NOW = new Date(2026, 8, 4, 10, 30, 0, 0); // 4 Sep 2026, a fixed "today"

console.log("Every date in the next 400 days, at a spread of times:");
{
  const times: [number, number][] = [
    [0, 0],   // midnight — parseWhen computes h % 12, so this must emit 12:00am
    [0, 30],
    [9, 0],
    [11, 59],
    [12, 0],  // noon — the other side of the same trap
    [12, 45],
    [15, 0],
    [16, 5],
    [23, 59],
  ];
  let mismatches = 0;
  let crossedYear = 0;
  let sample = "";
  for (let dayOffset = 0; dayOffset < 400; dayOffset++) {
    for (const [h, min] of times) {
      const when = new Date(NOW);
      when.setDate(when.getDate() + dayOffset);
      when.setHours(h, min, 0, 0);

      const text = formatWhen(when, NOW);
      if (!sample) sample = text;
      if (when.getFullYear() !== NOW.getFullYear()) crossedYear++;

      const back = parseWhen(text, NOW);
      const got = back.date && back.time
        ? { ...back.date, h: back.time.h, min: back.time.min }
        : null;
      if (JSON.stringify(got) !== JSON.stringify(parts(when))) {
        mismatches++;
        if (mismatches <= 3) {
          console.log(`      ✗ ${text}\n          got  ${JSON.stringify(got)}\n          want ${JSON.stringify(parts(when))}`);
        }
      }
    }
  }
  check(`3600 date/time combinations round-trip exactly`, mismatches, 0);
  // A sweep that never leaves the current year would prove nothing about the case
  // formatWhen carries a year for.
  check("…and the sweep really crossed into another year", crossedYear > 0, true);
  console.log(`      (e.g. "${sample}")`);
}

console.log("\nThe two cases the format exists to get right:");
{
  const sameYear = new Date(2026, 8, 5, 16, 0);
  check("same year omits it — what a person actually writes", formatWhen(sameYear, NOW), "5 Sep 4:00pm");

  // A December booking for January: without the year this comes back eleven months
  // early, and `explicitYear` is false so nothing corrects it.
  const nextYear = new Date(2027, 0, 5, 16, 0);
  check("another year carries it", formatWhen(nextYear, NOW), "5 Jan 2027 4:00pm");
  const back = parseWhen(formatWhen(nextYear, NOW), NOW);
  check("…and parses back to 2027, not 2026", back.date, { y: 2027, m: 1, d: 5 });
  check("…with explicitYear set, so no next-year correction fires", back.explicitYear, true);
}

console.log("\nMidnight and noon — where h % 12 bites:");
{
  check("00:00 → 12:00am", formatWhen(new Date(2026, 8, 5, 0, 0), NOW), "5 Sep 12:00am");
  check("…reads back as hour 0", parseWhen("5 Sep 12:00am", NOW).time, { h: 0, min: 0 });
  check("12:00 → 12:00pm", formatWhen(new Date(2026, 8, 5, 12, 0), NOW), "5 Sep 12:00pm");
  check("…reads back as hour 12", parseWhen("5 Sep 12:00pm", NOW).time, { h: 12, min: 0 });
}

console.log("\nThe formats patients already send still parse — the parser was widened, not changed:");
{
  const cases: [string, unknown, unknown][] = [
    ["12 Jul 3pm",        { y: 2026, m: 7, d: 12 }, { h: 15, min: 0 }],
    ["12 Jul 3:30pm",     { y: 2026, m: 7, d: 12 }, { h: 15, min: 30 }],
    ["Jul 12 3pm",        { y: 2026, m: 7, d: 12 }, { h: 15, min: 0 }],
    ["2026-07-12 15:00",  { y: 2026, m: 7, d: 12 }, { h: 15, min: 0 }],
    ["12/07 3pm",         { y: 2026, m: 7, d: 12 }, { h: 15, min: 0 }],
    ["12/07/2026 3pm",    { y: 2026, m: 7, d: 12 }, { h: 15, min: 0 }],
    ["tomorrow 4pm",      { y: 2026, m: 9, d: 5 },  { h: 16, min: 0 }],
    ["today 9am",         { y: 2026, m: 9, d: 4 },  { h: 9, min: 0 }],
    ["reschedule next Monday 3pm", { y: 2026, m: 9, d: 7 }, { h: 15, min: 0 }],
  ];
  for (const [text, date, time] of cases) {
    const p = parseWhen(text, NOW);
    check(`"${text}"`, { date: p.date, time: p.time }, { date, time });
  }
}

console.log("\nThe new year group is bounded to 20xx, and here is why:");
{
  check('"12 Jul 2027 3pm" takes the year', parseWhen("12 Jul 2027 3pm", NOW).date, { y: 2027, m: 7, d: 12 });
  check('"Jul 12, 2027 3pm" too', parseWhen("Jul 12, 2027 3pm", NOW).date, { y: 2027, m: 7, d: 12 });
  // 24-hour time written without a colon. An unbounded \d{4} would read this as the
  // year 1500 AND set explicitYear, which suppresses the next-year correction that
  // normally rescues a bare past date.
  const p = parseWhen("12 jul 1500", NOW);
  check('"12 jul 1500" is NOT read as the year 1500', p.date, { y: 2026, m: 7, d: 12 });
  check("…and explicitYear stays false, so the correction can still fire", p.explicitYear, false);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
