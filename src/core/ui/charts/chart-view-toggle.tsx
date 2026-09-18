"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/core/lib/utils";

/**
 * A 2D / 3D switch that swaps one chart for another in place.
 *
 * Both charts are rendered on the SERVER and handed in as children, so this holds
 * nothing but which one to show — no data crosses the boundary twice, and switching
 * is instant because neither view has to be fetched or built on the click.
 *
 * FLAT IS THE DEFAULT, deliberately. The dimensional view is the one you choose; a
 * reader who never touches the control gets the chart where a value is simply its
 * height. `note` rides along with the 3D view so its trade-off is stated where it
 * applies rather than as a permanent caption under a chart that no longer has it.
 *
 * Deliberately NOT persisted. Remembering the choice would mean reading storage after
 * mount and correcting the view, which flashes the wrong chart on every load — and the
 * house lint rule against setState-in-effect is pointing at exactly that pattern.
 */
export function ChartViewToggle({
  flat,
  deep,
  note,
  label,
  className,
}: {
  flat: ReactNode;
  deep: ReactNode;
  /** Shown under the chart only while the 3D view is on. */
  note?: ReactNode;
  /** Names the pair for a screen reader: "Earned vs paid, 2D". */
  label: string;
  className?: string;
}) {
  const [is3d, setIs3d] = useState(false);

  return (
    <div className={className}>
      <div className="mb-2 flex justify-end">
        <div
          className="inline-flex rounded-lg border border-input bg-[var(--input-bg)] p-0.5"
          role="group"
          aria-label={`${label} — chart style`}
        >
          {[
            { on: false, text: "2D" },
            { on: true, text: "3D" },
          ].map((opt) => (
            <button
              key={opt.text}
              type="button"
              onClick={() => setIs3d(opt.on)}
              aria-pressed={is3d === opt.on}
              className={cn(
                "rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors",
                is3d === opt.on
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.text}
              <span className="sr-only"> view of {label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Both trees exist; only the chosen one is mounted, so the hidden chart is not
          measuring itself against a zero-width container in the background. */}
      {is3d ? deep : flat}

      {is3d && note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
