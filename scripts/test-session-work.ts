/**
 * Unit tests for the work added this session — pure, no DB:
 *   - patient MRN format + search-digit extraction (core/patients/mrn)
 *   - live-queue status flow (core/appointments/status)
 *   - CSV escaping incl. the streaming single-row formatter (core/lib/csv)
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-session-work.ts`
 */
import { formatMrnLabel, mrnDigits, parseStartingMrn } from "../src/core/patients/mrn-series";
import {
  APPOINTMENT_STATUSES,
  nextQueueAction,
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
  // The clinic's series (2026-10-13): prefix + the counter at the starting width.
  check("FA-100001 → FA-, width 6, from 100001", parseStartingMrn("FA-100001"), { prefix: "FA-", width: 6, start: 100001 });
  check("GS-00000001 keeps its 8-digit padding", formatMrnLabel("GS-", 8, 2), "GS-00000002");
  check("AB-999 continues as AB-1000", formatMrnLabel("AB-", 3, 1000), "AB-1000");
  check("lower case is accepted and capitalised", parseStartingMrn("gs-001"), { prefix: "GS-", width: 3, start: 1 });
  check("digits in the prefix: last run is the counter", parseStartingMrn("MRN2024-0001"), { prefix: "MRN2024-", width: 4, start: 1 });
  check("fewer than 3 trailing digits refused", "error" in parseStartingMrn("AB-12"), true);
  check("under 3 characters refused", "error" in parseStartingMrn("A1"), true);
  check("over 15 characters refused", "error" in parseStartingMrn("ABCDEFGHIJKL-0001"), true);
  check("other characters refused", "error" in parseStartingMrn("FA_100001"), true);
  check("leading - refused", "error" in parseStartingMrn("-FA100"), true);
  check("digits: plain number", mrnDigits("42"), "42");
  check("digits: strips prefix + zeros kept", mrnDigits("FA-0000042"), "0000042");
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
  // Labels are no longer this module's concern — they live in the `appointment_statuses`
  // table (ADR-027) and `scripts/test-vocabulary-tables.ts` asserts the database matches
  // the seed. What stays here is what the CODE still owns: the queue flow above and the
  // badge variant below, which is a design-system mapping rather than vocabulary data.
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
