"use client";

import { useEffect, useRef } from "react";
import { logView } from "@/core/audit/actions";

/**
 * Logs a record "view" once, on mount. Rendered by detail pages. Runs in a
 * client effect (not the server render) so Next's link PREFETCH — which fetches
 * the RSC payload but never mounts client effects — doesn't create phantom view
 * logs; only a real navigation does. Renders nothing.
 */
export function ViewLogger({
  entity,
  entityId,
  summary,
}: {
  entity: string;
  entityId: string | null;
  summary: string;
}) {
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    void logView(entity, entityId, summary);
  }, [entity, entityId, summary]);
  return null;
}
