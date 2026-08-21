import "server-only";

import { serverEnv, isProduction } from "@/core/lib/env";
import { currentContext } from "@/core/observability/context";
import { redact, redactError, redactText } from "@/core/observability/redact";

/**
 * The error sink — CORE. This is what a bare `catch {}` turns into.
 *
 * THE PROBLEM IT SOLVES: this codebase deliberately swallows failures in a lot of
 * places, and mostly that's correct — a WhatsApp send must never break the booking
 * that triggered it, an audit write must never break the action it records. But
 * "swallow" had come to mean "and tell absolutely nobody", including in the sales,
 * share and settlement ledgers and the audit trail. Revenue could silently stop being
 * recorded and the first hint would be a clinic asking why their numbers look wrong.
 *
 * So the contract here is: keep the swallow, lose the blindness. `report()` never
 * throws and never blocks, so it is safe to call from inside a failure path; the
 * caller's control flow is unchanged. What changes is that the failure now leaves a
 * trace.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO SENTRY SDK HERE
 * ─────────────────────────────────────────────────────────────────────────
 * CLAUDE.md §2 says don't add major dependencies without a clear reason, and §10
 * says patient PII must never reach an error tracker in plain text. Both point the
 * same way: emit structured JSON on stdout/stderr — which every host already
 * collects (Vercel log drains, Docker, journald, CloudWatch) — and expose ONE
 * optional HTTP sink for whichever service is chosen later. Adding Sentry then is a
 * change to `deliver()` below and nothing else; no call site moves. Redaction stays
 * ours either way, which is the part that must not be delegated to a vendor.
 */

export type Severity = "error" | "warn" | "info";

export type ReportContext = {
  /**
   * Stable dotted operation name — the GROUPING KEY for alerts, so keep it constant
   * for a given code path: "sales.recordSale", "audit.logActivity", "whatsapp.send".
   */
  op: string;
  clinicId?: string | null;
  userId?: string | null;
  /**
   * Entity ids that identify the affected row(s) — appointmentId, visitId, patientId.
   * Ids ONLY: they're what makes a report actionable and they name a row, not a
   * person. Never put names, phones or clinical text here (redaction would mask them
   * anyway, so they'd just be noise).
   */
  ids?: Record<string, string | number | null | undefined>;
  /** Any extra detail. Deep-redacted before it is emitted. */
  extra?: Record<string, unknown>;
  severity?: Severity;
};

const LEVEL_RANK: Record<Severity, number> = { error: 3, warn: 2, info: 1 };
const MIN_RANK = LEVEL_RANK[serverEnv.LOG_LEVEL as Severity] ?? LEVEL_RANK.info;

/** One emitted record. Flat and stable so it greps and filters cleanly. */
type LogRecord = {
  ts: string;
  level: Severity;
  op: string;
  msg: string;
  requestId?: string;
  entry?: string;
  clinicId?: string;
  userId?: string;
  ids?: Record<string, unknown>;
  err?: unknown;
  extra?: unknown;
};

/**
 * Ship a record to the optional external sink. Fire-and-forget with a hard timeout:
 * observability must never add latency to, or become a new failure mode of, the path
 * it's observing. Failures here are dropped on the floor ON PURPOSE — calling
 * `report()` from the reporter is how you build an infinite loop.
 */
function deliver(record: LogRecord): void {
  const url = serverEnv.OBSERVABILITY_WEBHOOK_URL;
  if (!url) return;
  try {
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    // Never recurse into report().
  }
}

/** Human-readable in dev; one JSON line per record in production. */
function emit(record: LogRecord): void {
  const sink = record.level === "info" ? console.log : console.error;
  if (isProduction) {
    sink(JSON.stringify(record));
  } else {
    const where = record.requestId ? ` (${record.requestId.slice(0, 8)})` : "";
    sink(`[${record.level}] ${record.op}${where}: ${record.msg}`);
    if (record.ids && Object.keys(record.ids).length) sink("  ids:", record.ids);
    if (record.err) sink("  err:", record.err);
    if (record.extra) sink("  extra:", record.extra);
  }
  deliver(record);
}

/** Build the record, merging explicit context over the ambient request context. */
function build(
  level: Severity,
  msg: string,
  ctx: ReportContext,
  err?: unknown,
): LogRecord {
  const ambient = currentContext();
  const record: LogRecord = {
    ts: new Date().toISOString(),
    level,
    op: ctx.op,
    // MUST be redacted like everything else. An error message is free text and
    // routinely carries what it choked on — "could not deliver to 9230…" — so a raw
    // `msg` would leak exactly what `err.message` is careful not to.
    msg: redactText(msg),
  };
  if (ambient?.requestId) record.requestId = ambient.requestId;
  if (ambient?.entry) record.entry = ambient.entry;
  const clinicId = ctx.clinicId ?? ambient?.clinicId;
  const userId = ctx.userId ?? ambient?.userId;
  if (clinicId) record.clinicId = clinicId;
  if (userId) record.userId = userId;
  if (ctx.ids) {
    const ids: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx.ids)) if (v != null) ids[k] = v;
    if (Object.keys(ids).length) record.ids = ids;
  }
  if (err !== undefined) record.err = redactError(err);
  if (ctx.extra) record.extra = redact(ctx.extra);
  return record;
}

/**
 * Records a swallowed failure. Use in place of an empty catch:
 *
 *   } catch (e) {
 *     report(e, { op: "sales.recordSale", clinicId, ids: { appointmentId } });
 *   }
 *
 * Never throws — a reporting bug must not become the failure it was reporting.
 */
export function report(error: unknown, ctx: ReportContext): void {
  try {
    const level = ctx.severity ?? "error";
    if (LEVEL_RANK[level] < MIN_RANK) return;
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "failed";
    emit(build(level, message, ctx, error));
  } catch {
    // Deliberately terminal.
  }
}

/**
 * Records something noteworthy that isn't an exception — a tenant-guard violation, a
 * reconciliation mismatch, a provider refusing a send. Same guarantees as `report`.
 */
export function reportEvent(message: string, ctx: ReportContext): void {
  try {
    const level = ctx.severity ?? "warn";
    if (LEVEL_RANK[level] < MIN_RANK) return;
    emit(build(level, message, ctx));
  } catch {
    // Deliberately terminal.
  }
}
