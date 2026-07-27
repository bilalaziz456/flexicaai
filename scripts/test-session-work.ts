/**
 * Unit tests for the work added this session — pure, no DB:
 *   - patient MRN format + search-digit extraction (core/patients/mrn)
 *   - live-queue status flow (core/appointments/status)
 *   - CSV escaping incl. the streaming single-row formatter (core/lib/csv)
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-session-work.ts`
 */
import { formatMrn, mrnDigits } from "../src/core/patients/mrn";
import {
  APPOINTMENT_STATUSES,
  nextQueueAction,
  statusLabel,
  statusVariant,
} from "../src/core/appointments/status";
import { csvLine, toCsv } from "../src/core/lib/csv";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`);
  }
}

console.log("Patient MRN:");
{
  const d = new Date(2026, 6, 11, 9, 30); // 2026-07-11, local
  check("format = prefix + YYYYMMDD + 7-digit", formatMrn("KL-", 42, d), "KL-202607110000042");
  check("counter zero-pads to 7", formatMrn("KL-", 3, d), "KL-202607110000003");
  check("large counter not truncated", formatMrn("KL-", 1234567, d), "KL-202607111234567");
  check("null mrn → null", formatMrn("KL-", null, d), null);
  check("empty prefix tolerated", formatMrn("", 1, d), "202607110000001");
  check("digits: plain number", mrnDigits("42"), "42");
  check("digits: strips prefix + zeros kept", mrnDigits("KL-202607110000042"), "202607110000042");
  check("digits: hash/space stripped", mrnDigits("# 42 "), "42");
  check("digits: none → empty", mrnDigits("abc"), "");
}

console.log("Live-queue status flow:");
{
  check("enum has the two new states", [
    APPOINTMENT_STATUSES.includes("arrived"),
    APPOINTMENT_STATUSES.includes("in_progress"),
  ], [true, true]);
  check("scheduled → Arrived", nextQueueAction("scheduled"), { status: "arrived", label: "Arrived" });
  check("confirmed → Arrived", nextQueueAction("confirmed"), { status: "arrived", label: "Arrived" });
  check("arrived → Call in (in_progress)", nextQueueAction("arrived"), { status: "in_progress", label: "Call in" });
  check("in_progress → Complete (completed)", nextQueueAction("in_progress"), { status: "completed", label: "Complete" });
  check("completed → no action", nextQueueAction("completed"), null);
  check("cancelled → no action", nextQueueAction("cancelled"), null);
  check("no_show → no action", nextQueueAction("no_show"), null);
  check("label: in_progress", statusLabel("in_progress"), "In progress");
  check("label: no_show", statusLabel("no_show"), "No-show");
  check("label: unknown falls back", statusLabel("weird_x"), "weird x");
  check("variant: in_progress = default", statusVariant("in_progress"), "default");
  check("variant: arrived = outline", statusVariant("arrived"), "outline");
  check("variant: unknown = secondary", statusVariant("zzz"), "secondary");
}

console.log("CSV (RFC-4180 + streaming row):");
{
  check("plain fields pass through", csvLine(["a", 1, null]), "a,1,");
  check("comma is quoted", csvLine(["a,b"]), '"a,b"');
  check("quote is doubled + wrapped", csvLine(['he said "hi"']), '"he said ""hi"""');
  check("newline is quoted", csvLine(["line1\nline2"]), '"line1\nline2"');
  check("null/undefined → empty", csvLine([null]), "");
  check(
    "toCsv joins header + rows with CRLF",
    toCsv(["A", "B"], [["1", "2"], ["x,y", "z"]]),
    'A,B\r\n1,2\r\n"x,y",z',
  );
  // csvLine is the exact unit the streaming export emits per row — parity with toCsv.
  check("csvLine matches toCsv's row rendering", csvLine(["x,y", "z"]), toCsv([], [["x,y", "z"]]).split("\r\n")[1]);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
