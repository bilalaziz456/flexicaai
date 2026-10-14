/**
 * One naming rule for every patient file (owner's call, 2026-10-15):
 * "patient - section - date time". Pure. Run:
 * `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-file-name.ts`
 */
import { cleanFileName, contentDisposition, fileStamp, patientFileName } from "@/core/lib/file-name";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const at = new Date(2026, 9, 15, 1, 45);
ok("the stamp has no colon", fileStamp(at) === "15 Oct 2026 01-45 AM", fileStamp(at));
const name = patientFileName("test patient", "Prescription", at);
ok("patient - section - date time", name === "test patient - Prescription - 15 Oct 2026 01-45 AM", name);
ok("characters a file system refuses are replaced", cleanFileName('a/b:c*d?"e') === "a-b-c-d-e", cleanFileName('a/b:c*d?"e'));
ok("no name falls back to 'Patient'", patientFileName("", "Statement", at).startsWith("Patient - Statement"));
const urdu = contentDisposition("attachment", "علی - Prescription.pdf");
ok("an Urdu name keeps an ASCII fallback…", /filename="_+ - Prescription\.pdf"/.test(urdu), urdu);
ok("…and carries the real name encoded", urdu.includes("filename*=UTF-8''%D8%B9"), urdu);
ok("the header is plain Latin-1", [...urdu].every((ch) => ch.charCodeAt(0) < 256));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
