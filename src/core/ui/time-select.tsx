"use client";

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

const cls =
  "h-8 min-w-0 flex-1 rounded-lg border border-input bg-[var(--input-bg)] px-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

/**
 * A time picker built from native <select>s (hour / minute / AM-PM) — no clock
 * icon and the AM/PM renders consistently on every device (native time inputs
 * clip/vary). Controlled; value is "HH:MM" (24h). CORE, reused by the doctor
 * schedule editor and the appointment scheduling form.
 */
export function TimeSelect({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const { hour12, minute, mer } = to12(value);
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();

  return (
    <div className="flex flex-1 items-center gap-1">
      <select
        aria-label={`${ariaLabel} hour`}
        disabled={disabled}
        value={hour12}
        onChange={(e) => onChange(to24(Number(e.target.value), minute, mer))}
        className={cls}
      >
        {HOURS12.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">:</span>
      <select
        aria-label={`${ariaLabel} minute`}
        disabled={disabled}
        value={minute}
        onChange={(e) => onChange(to24(hour12, e.target.value, mer))}
        className={cls}
      >
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select
        aria-label={`${ariaLabel} AM or PM`}
        disabled={disabled}
        value={mer}
        onChange={(e) => onChange(to24(hour12, minute, e.target.value as "AM" | "PM"))}
        className={`${cls} w-16 flex-none`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
