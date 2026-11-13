"use client";

import { SelectField } from "@/core/ui/select-field";
import { cn } from "@/core/lib/utils";

const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")); // 00,05,..55

/** "HH:MM" (24h) → 12-hour parts. */
function to12(hhmm: string): { hour12: number; minute: string; mer: "AM" | "PM" } {
  const [h, m] = (hhmm || "09:00").split(":").map(Number);
  const hour = Number.isFinite(h) ? h : 9;
  const min = Number.isFinite(m) ? m : 0;
  const mer = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { hour12, minute: String(min).padStart(2, "0"), mer };
}

/** 12-hour parts → "HH:MM" (24h). */
function to24(hour12: number, minute: string, mer: "AM" | "PM"): string {
  let h = hour12 % 12;
  if (mer === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

/**
 * A time picker of three themed dropdowns (hour / minute / AM-PM) — no clock icon,
 * and the AM/PM reads the same on every device (native time inputs clip and vary).
 * Controlled; value is "HH:MM" (24h). CORE, reused by the doctor schedule editor,
 * the appointment form and announcements.
 *
 * They were native <select>s, whose OS list (system-blue highlight, platform font)
 * looked like part of another program beside the app's own dropdowns (owner's
 * report, 2026-11-14). Each box has a FIXED width: shared out by flex, the minute box
 * once came to 49px and clipped "00" to "0C"; measured to its content, it jumped as
 * the value changed. Fixed widths fit the widest value with room for the chevron.
 */
export function TimeSelect({
  value,
  disabled,
  onChange,
  ariaLabel,
  size = "sm",
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  ariaLabel: string;
  /** `default` matches an Input / DatePicker beside it (h-9); `sm` fits the compact
   *  rows of the doctor schedule editor (h-8). */
  size?: "sm" | "default";
}) {
  const { hour12, minute, mer } = to12(value);
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();
  const height = size === "default" ? "h-9" : "h-8 px-2";
  // Twelve rows would run off a short screen; the list scrolls instead.
  const popup = "max-h-64 overflow-y-auto";

  return (
    <div className="flex items-center gap-1">
      <SelectField
        ariaLabel={`${ariaLabel} hour`}
        disabled={disabled}
        value={String(hour12)}
        onValueChange={(h) => onChange(to24(Number(h), minute, mer))}
        options={HOURS12.map((h) => ({ value: String(h), label: String(h) }))}
        className={cn(height, "w-16 shrink-0")}
        popupClassName={popup}
      />
      <span className="text-muted-foreground">:</span>
      <SelectField
        ariaLabel={`${ariaLabel} minute`}
        disabled={disabled}
        value={minute}
        onValueChange={(m) => onChange(to24(hour12, m, mer))}
        options={minuteOptions.map((m) => ({ value: m, label: m }))}
        className={cn(height, "w-16 shrink-0")}
        popupClassName={popup}
      />
      <SelectField
        ariaLabel={`${ariaLabel} AM or PM`}
        disabled={disabled}
        value={mer}
        onValueChange={(m) => onChange(to24(hour12, minute, m as "AM" | "PM"))}
        options={[
          { value: "AM", label: "AM" },
          { value: "PM", label: "PM" },
        ]}
        className={cn(height, "w-[4.5rem] shrink-0")}
      />
    </div>
  );
}
