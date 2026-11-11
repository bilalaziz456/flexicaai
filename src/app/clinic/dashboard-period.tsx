"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PeriodTabs } from "@/core/ui/report-filters";
import { DASHBOARD_PERIODS } from "./dashboard-periods";

/** The dashboard's period picker. The proxy remembers the pick until sign-out. */
export function DashboardPeriod({ period }: { period: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(period);
  return (
    <PeriodTabs
      label="Showing"
      value={value}
      presets={DASHBOARD_PERIODS.map(({ value, label, title }) => ({ value, label, title }))}
      onChange={(v) => {
        setValue(v);
        router.replace(`${pathname}?period=${v}`, { scroll: false });
      }}
    />
  );
}
