"use server";

import { logActivity } from "@/core/audit/log";

/**
 * Records a "view" of a record — invoked from the client `ViewLogger` on mount,
 * so it fires on an ACTUAL page view (not on Next's link prefetch, which would
 * happen if we logged during the server render). Best-effort via logActivity.
 */
export async function logView(
  entity: string,
  entityId: string | null,
  summary: string,
): Promise<void> {
  await logActivity({ action: "view", entity, entityId, summary });
}
