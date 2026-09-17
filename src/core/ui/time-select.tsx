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

// Each select takes its INTRINSIC width (widest option + our padding) rather than
// `flex-1 min-w-0`. Shared out by flex, the minute box came to 49px — 19px of content
// for a "00" that measures 20.5px in Plus Jakarta Sans, so the second digit was shaved
// and read as "0C". A flexed width has no floor, so any narrower row clips again;
// letting the content size the box means it cannot. `pr-5` + `select-chevron-sm`
// reserve exactly the room our own chevron needs (appearance:none removes the native
// arrow, which is drawn INSIDE the box and would overlap the value).
const cls =
  "select-chevron-sm h-8 w-auto shrink-0 rounded-lg border border-input bg-[var(--input-bg)] py-0 pl-2 pr-5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

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
    <div className="flex items-center gap-1">
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
        className={cls}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
