/**
 * Unit tests for PII redaction (core/observability/redact) — pure, no DB.
 *
 * WHY THIS IS TESTED AND THE REST OF THE SINK ISN'T: everything else in
 * observability fails safe. If `report()` has a bug, the worst case is a missing log
 * line — annoying, not harmful. If REDACTION has a bug, patient names, phone numbers
 * and clinical notes leave the building and land in a log store or a third-party
 * ingest URL, which is precisely what CLAUDE.md §10 forbids. That asymmetry is the
 * whole reason this file exists.
 *
 * Run: `tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-observability.ts`
 */
import { redact, redactText, redactError } from "../src/core/observability/redact";

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
function checkTrue(name: string, cond: boolean) {
  check(name, cond, true);
}

console.log("Sensitive keys are masked by name:");
{
  const r = redact({
    fullName: "Ayesha Khan",
    phone: "923001234567",
    email: "ayesha@example.com",
    transcript: "patient reports pain in the upper left quadrant",
    note: { complaint: "toothache" },
  }) as Record<string, unknown>;

  check("fullName masked", r.fullName, "[redacted:11]");
  check("phone masked", r.phone, "[redacted:12]");
  check("email masked", r.email, "[redacted:18]");
  check("transcript masked", r.transcript, "[redacted:47]");
  // `note` is sensitive by key, so the whole subtree goes — we never have to trust
  // that every field inside a clinical blob was individually enumerated.
  check("clinical note masked wholesale", r.note, "[redacted]");
}

console.log("\nKey matching is separator- and case-insensitive:");
{
  const r = redact({
    full_name: "Ayesha Khan",
    FullName: "Ayesha Khan",
    "patient-name": "Ayesha Khan",
    PHONE: "923001234567",
  }) as Record<string, unknown>;
  check("snake_case", r.full_name, "[redacted:11]");
  check("PascalCase", r.FullName, "[redacted:11]");
  check("kebab-case", r["patient-name"], "[redacted:11]");
  check("UPPERCASE", r.PHONE, "[redacted:12]");
}

console.log("\nIds survive — they are what makes a report actionable:");
{
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const r = redact({
    appointmentId: id,
    clinicId: id,
    visitId: id,
    amount: 5000,
    status: "completed",
  }) as Record<string, unknown>;
  check("appointmentId intact", r.appointmentId, id);
  check("clinicId intact", r.clinicId, id);
  check("amount intact", r.amount, 5000);
  check("status intact", r.status, "completed");
}

console.log("\nFree text is scrubbed by pattern, not just by key:");
{
  // The dangerous case: PII inside a string nobody labelled as sensitive.
  check(
    "phone in free text",
    redactText("failed to send to 923001234567"),
    "failed to send to [digits:12]",
  );
  check(
    "email in free text",
    redactText("no mailbox for ayesha@example.com here"),
    "no mailbox for [email] here",
  );
  check("short numbers survive", redactText("row 42 of 100"), "row 42 of 100");
  // A UUID contains long digit runs but identifies a ROW, not a person.
  check(
    "uuid not mangled",
    redactText("appointment 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed"),
    "appointment 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed",
  );
}

console.log("\nPostgres errors keep the cause, drop the row values:");
{
  // The `pg` driver attaches `detail` on a constraint violation — and `detail`
  // embeds the offending VALUE ("Key (username)=(dr.bilal) already exists"), which
  // is exactly what must not reach a log store.
  const e = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "users_username_unique",
    detail: "Key (username)=(dr.bilal) already exists.",
    where: "SQL statement \"INSERT INTO users\"",
  });
  const r = redactError(e);
  check("code kept", r.code, "23505");
  check("constraint kept", r.constraint, "users_username_unique");
  checkTrue("detail dropped entirely", !("detail" in r));
  checkTrue("where dropped entirely", !("where" in r));
  checkTrue("message kept", r.message.includes("duplicate key"));
  checkTrue("stack truncated but present", (r.stack ?? "").split("\n").length <= 12);
}

console.log("\nIt cannot become a second failure:");
{
  // report() runs INSIDE a catch block. If redaction threw or hung on a pathological
  // input, it would turn a handled failure into an unhandled one.
  const cyclic: Record<string, unknown> = { name: "x" };
  cyclic.self = cyclic;
  const r = redact(cyclic) as Record<string, unknown>;
  check("cycles are broken", r.self, "[circular]");

  const deep = { a: { b: { c: { d: { e: { f: { g: { h: "deep" } } } } } } } };
  checkTrue("depth is bounded", JSON.stringify(redact(deep)).includes("[depth-limit]"));

  const wide = { items: Array.from({ length: 500 }, (_, i) => i) };
  const w = redact(wide) as { items: unknown[] };
  check("arrays are capped", w.items.length, 21);
  check("and say what was dropped", w.items[20], "[+480 more]");

  check("null survives", redact(null), null);
  check("undefined survives", redact(undefined), undefined);
  check("a bare string is scrubbed", redact("call 923001234567"), "call [digits:12]");
  check("a thrown non-Error is handled", redactError("boom").message, "boom");
}

console.log("\nThe emitted record leaks nothing (regression):");
{
  // This caught a real bug: `err.message` was being redacted but the record's
  // top-level `msg` — built from the same string — was not, so a phone number in an
  // error message went out in plain text. Both paths are asserted from now on.
  const raw = "could not deliver to 923001234567 <ayesha@example.com>";
  const err = redactError(new Error(raw));
  checkTrue("err.message is scrubbed", !/923001234567|ayesha@/.test(err.message));
  checkTrue("…and redactText gives the same result for the msg field",
    !/923001234567|ayesha@/.test(redactText(raw)));

  // Nothing identifying should survive a round-trip of a realistic report payload.
  const serialized = JSON.stringify(
    redact({
      patient: { fullName: "Ayesha Khan", phone: "923001234567", dob: "1990-04-02" },
      appointmentId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      transcript: "upper left quadrant pain",
    }),
  );
  checkTrue("no name in the payload", !serialized.includes("Ayesha"));
  checkTrue("no phone in the payload", !serialized.includes("923001234567"));
  checkTrue("no clinical text in the payload", !serialized.includes("quadrant"));
  checkTrue("the id still is", serialized.includes("3f2504e0"));
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
