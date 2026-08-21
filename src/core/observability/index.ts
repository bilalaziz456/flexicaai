/**
 * Observability — CORE, specialty-agnostic. One import path for the whole app:
 *
 *   import { report, reportEvent } from "@/core/observability";
 *
 * See `report.ts` for the contract (never throws, never blocks, always redacts) and
 * `redact.ts` for how patient PII is kept out of log stores (CLAUDE.md §10).
 */
export { report, reportEvent, type ReportContext, type Severity } from "@/core/observability/report";
export {
  runWithContext,
  withRequestContext,
  enrichContext,
  currentContext,
  type RequestContext,
} from "@/core/observability/context";
export { redact, redactText, redactError, type RedactedError } from "@/core/observability/redact";
