"use client";

import { usePathname, useRouter } from "next/navigation";
import { DatePicker, DATE_FIELD_W } from "@/core/ui/date-picker";
import { Label } from "@/core/ui/label";

/** Day selector for the day book — navigates to ?date=YYYY-MM-DD. */
export function DayBookControls({ date }: { date: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">Day</Label>
      <div className={DATE_FIELD_W}>
        <DatePicker
          id="daybook-date"
          ariaLabel="Day"
          value={date}
          onChange={(v) => router.replace(`${pathname}?date=${v}`, { scroll: false })}
        />
      </div>
    </div>
  );
}
