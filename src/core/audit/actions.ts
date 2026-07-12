"use server";

import { logView as recordView } from "@/core/audit/log";

/**
 * Records a "view" of a record — invoked from the client `ViewLogger` on mount,
 * so it fires on an ACTUAL page view (not on Next's link prefetch, which would
 * happen if we logged during the server render). De-duplicated within a short
 * window (see logView) so refreshing/re-opening a record doesn't spam the log.
 */
export async function logView(
  entity: string,
  entityId: string | null,
  summary: string,
): Promise<void> {
  await recordView(entity, entityId, summary);
}
