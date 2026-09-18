"use client";

import { useRouter } from "next/navigation";
import { nativeSelectClass } from "@/core/ui/select-field";

/**
 * The month filter over the schedule. Picking a month jumps to the week that month
 * starts with — the schedule is a week at a time, so "September" means "take me to the
 * start of September", not "show me 30 columns".
 *
 * A plain `<select>` on purpose — a month list is the one case where the native
 * control is better on a phone than anything we would build, and this is a filter
 * people change often and read rarely.
 *
 * The options span a year either side. Further back than that is history nobody
 * schedules against, and further forward is a rota nobody has set yet; both are still
 * reachable with the arrows, which is the right cost for the rare case.
 */
export function MonthSelect({
  value,
  months,
}: {
  /** The selected month as "YYYY-MM". */
  value: string;
  /** `{ value: "2026-09", label: "September 2026" }`, oldest first. */
  months: { value: string; label: string }[];
}) {
  const router = useRouter();

  return (
    <select
      className={`${nativeSelectClass} w-48`}
      value={value}
      aria-label="Month"
      onChange={(e) => {
        router.push(`/clinic/schedule?from=${e.target.value}-01`, { scroll: false });
      }}
    >
      {months.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
