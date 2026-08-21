import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Ambient request context — CORE. Carries the ids that make a report traceable
 * (`requestId`, and whoever/whatever the request is acting as) so a `report()` call
 * buried five layers down doesn't have to be handed them by every caller in between.
 *
 * WHY AsyncLocalStorage: it's already the established pattern in this codebase — the
 * tenant guard (`core/db/tenant-guard.ts`) uses ALS for exactly this reason, to let a
 * deep query know something the entry point decided. Same mechanism, same trade-offs.
 *
 * WHY IT'S OPTIONAL: there is no single Node entry point in the App Router to wrap,
 * and the Edge proxy can't share an ALS store with the Node render anyway. So this is
 * seeded at the entry points where correlation actually pays — the background and
 * webhook paths, which have no page to look at when they go wrong — and everything
 * else simply reports without a requestId. `report()` never depends on a store being
 * active, and the explicit context passed at each call site is the higher-signal data
 * regardless.
 */

export type RequestContext = {
  /** Correlates every log line from one request. Minted by the Edge proxy when present. */
  requestId: string;
  /** A stable name for the entry point, e.g. "cron.reminders" or "webhook.whatsapp.cloud". */
  entry: string;
  clinicId?: string | null;
  userId?: string | null;
};

const store = new AsyncLocalStorage<RequestContext>();

/** The active context, or undefined outside a wrapped entry point. */
export function currentContext(): RequestContext | undefined {
  return store.getStore();
}

/** Runs `fn` with an ambient context. Nested calls replace the store for their subtree. */
export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, async () => await fn());
}

/**
 * Merge extra fields into the active context for the rest of the current entry point
 * — e.g. a webhook that only learns its `clinicId` after routing by phone number.
 * A no-op when no context is active, so it's always safe to call.
 */
export function enrichContext(fields: Partial<Omit<RequestContext, "requestId">>): void {
  const ctx = store.getStore();
  if (!ctx) return;
  Object.assign(ctx, fields);
}

/**
 * Wraps a Route Handler body in a request context, reusing the `x-request-id` the
 * Edge proxy minted so the same id spans proxy → handler → any report it emits.
 * Falls back to a fresh id when the header is absent (a direct call, a test).
 *
 *   export async function GET(request: Request) {
 *     return withRequestContext("cron.recalls", request, async () => { … });
 *   }
 */
export function withRequestContext<T>(
  entry: string,
  request: Request,
  fn: () => Promise<T>,
): Promise<T> {
  const requestId = request.headers.get("x-request-id") || randomUUID();
  return runWithContext({ requestId, entry }, fn);
}
