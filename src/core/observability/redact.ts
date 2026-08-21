/**
 * PII redaction — CORE, specialty-agnostic and PURE (no DB, no server-only) so it can
 * be unit-tested and reused by any sink.
 *
 * WHY THIS EXISTS AT ALL: CLAUDE.md §10 is explicit — "Never log patient PII to
 * console or error trackers in plain text." Observability and that rule pull in
 * opposite directions, because the most useful thing to log about a failure is
 * usually the row that caused it. This module is where the two are reconciled: we
 * keep the SHAPE of the data and throw away the identifying VALUES.
 *
 * Two passes, because PII arrives two ways:
 *   1. By KEY — an object carrying `phone`, `fullName`, `transcript`… → replace the
 *      value with a placeholder that still tells you the field was populated.
 *   2. By PATTERN — free text (a Postgres error `detail`, a provider's error body)
 *      that has a phone number or email embedded in it → mask the run of digits.
 *
 * The bias is deliberately toward OVER-redacting. A log line that says
 * `phone: "[redacted:11]"` is still enough to debug ("the phone was present and
 * 11 chars"), and the cost of guessing wrong in the other direction is patient data
 * in a third-party log store.
 */

/** Placeholder for a redacted value; keeps the length as a debugging hint. */
function mask(value: unknown): string {
  if (typeof value === "string") return `[redacted:${value.length}]`;
  if (value === null || value === undefined) return "[redacted:empty]";
  return "[redacted]";
}

/**
 * Field names whose VALUES are patient/staff-identifying. Matched
 * case-insensitively against the key with separators stripped, so `full_name`,
 * `fullName` and `FullName` all hit the same entry.
 */
const SENSITIVE_KEYS = new Set([
  // Identity
  "name", "fullname", "patientname", "doctorname", "actorname", "createdbyname",
  "issuedbyname", "recordedbyname", "decidedbyname", "sendername", "username",
  "prefix", "ownername",
  // Contact
  "phone", "email", "address", "displaynumber", "ownerphone", "owneremail",
  "to", "destination", "recipient",
  // Government / medical identifiers
  "cnic", "nic", "passport", "mrn", "dateofbirth", "dob", "birthdate",
  // Clinical free text — the most sensitive of all
  "note", "notes", "transcript", "aidraft", "chart", "body", "summary",
  "reason", "diagnosis", "complaint", "description", "text", "message",
  // Credentials & tokens
  "password", "passwordhash", "token", "tokenhash", "secret", "apikey",
  "authorization", "cookie", "signature", "sessiontoken",
  // Money-adjacent identifiers that can identify a person
  "reference", "externalpatientref",
]);

/** Normalise a key for lookup: lowercase, drop separators. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\-\s.]/g, "");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

// Free-text patterns. Kept deliberately blunt — a false positive costs a masked
// number in a log line; a false negative costs a patient's phone in a log store.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** 7+ consecutive digits, allowing spaces/dashes/parens — phones, CNICs, card-like runs. */
const LONG_DIGITS_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g;

/**
 * Mask identifying patterns inside a free-text string. UUIDs are deliberately left
 * intact: they're the entity ids that make a report actionable, and they identify a
 * row, not a person.
 */
export function redactText(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(LONG_DIGITS_RE, (m) => {
      // Don't mangle a UUID that happened to match (they contain digit runs).
      if (/^[0-9a-f-]{20,}$/i.test(m.trim())) return m;
      return `[digits:${m.replace(/\D/g, "").length}]`;
    });
}

/**
 * Deep-redact an arbitrary value for logging. Objects/arrays are walked; sensitive
 * KEYS have their values masked; remaining strings are pattern-scrubbed. Cycles and
 * runaway structures are bounded — this runs inside a failure path and must not
 * become a second failure.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") return redactText(value as string);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return String(value);
  if (t === "function" || t === "symbol") return `[${t}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value);

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    // Cap width: a 10k-row array in a log line helps nobody.
    const out = value.slice(0, 20).map((v) => redact(v, depth + 1, seen));
    if (value.length > 20) out.push(`[+${value.length - 20} more]`);
    return out;
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return "[circular]";
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = isSensitiveKey(k) ? mask(v) : redact(v, depth + 1, seen);
    }
    return out;
  }
  return "[unknown]";
}

/** The safe, structured shape of an Error for a log line. */
export type RedactedError = {
  name: string;
  message: string;
  /** Postgres/driver code (e.g. "23505" unique_violation) — never PII, always useful. */
  code?: string;
  /** Postgres constraint name — points at the rule that failed, carries no values. */
  constraint?: string;
  stack?: string;
  cause?: unknown;
};

/**
 * Normalise an unknown throwable into a safe object.
 *
 * The `pg` driver deserves specific handling: on a constraint violation it attaches
 * `detail` ("Key (username)=(dr.bilal) already exists") and `where`, which embed the
 * offending ROW VALUES. Those are exactly what we must not ship to a log store, so
 * they are dropped entirely while `code` and `constraint` — which say what rule broke
 * without saying who broke it — are kept.
 */
export function redactError(e: unknown): RedactedError {
  if (e instanceof Error) {
    const pg = e as Error & { code?: unknown; constraint?: unknown; cause?: unknown };
    return {
      name: e.name,
      message: redactText(e.message),
      ...(typeof pg.code === "string" ? { code: pg.code } : {}),
      ...(typeof pg.constraint === "string" ? { constraint: pg.constraint } : {}),
      // The stack is file paths and function names — no row data.
      ...(e.stack ? { stack: e.stack.split("\n").slice(0, 12).join("\n") } : {}),
      ...(pg.cause !== undefined && pg.cause !== null
        ? { cause: redact(pg.cause, 5) }
        : {}),
    };
  }
  if (typeof e === "string") return { name: "Thrown", message: redactText(e) };
  return { name: "Thrown", message: JSON.stringify(redact(e)) ?? "unknown" };
}
