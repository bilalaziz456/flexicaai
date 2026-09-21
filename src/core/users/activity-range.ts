import "server-only";

import { resolveSalesRange, type ResolvedRange } from "@/core/sales/report";
import { activityPresetDates } from "@/core/users/activity-periods";

/**
 * Turns an activity period — `"3m"`/`"6m"`/`"9m"`/`"12m"`, or `"custom"` with a
 * from/to — into the concrete range `getDoctorActivity` queries over.
 *
 * It DELEGATES to `resolveSalesRange`'s custom branch rather than building a range
 * itself. That function already owns the date parsing, the reversed-range guard and
 * the bucket-size choice, and a second answer to "what does this window mean" would
 * be one more thing to keep in step for nothing gained. A month preset is just a
 * from/to that `activityPresetDates` derives; after that there is one code path, so a
 * custom range and a preset cannot behave differently.
 */
export function resolveActivityRange(
  period: string | undefined,
  from?: string,
  to?: string,
): ResolvedRange {
  if (period === "custom") return resolveSalesRange("custom", from, to);
  const preset = activityPresetDates(period);
  return resolveSalesRange("custom", preset.from, preset.to);
}
