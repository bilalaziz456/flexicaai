import { cn } from "@/core/lib/utils";

export type Segment = { label: string; value: number; color: string };

/**
 * COMPOSITION, in one line — how a portfolio divides: clinics by status, months by
 * payer band. Every segment's width is its share of the whole.
 *
 * A donut would answer the same question and is the right call when composition IS
 * the content of a card. This is for a composition that has to sit in a STRIP,
 * alongside other figures, where a 168px ring would take the whole row. It keeps the
 * one property that matters — the segments add up to the total in front of you, which
 * a row of count chips only asserts.
 *
 * Ordered by the CALLER, never by size: a status bar reads trial → active → suspended
 * → past due → cancelled because that is a lifecycle, and sorting it by how many
 * clinics happen to be in each state would reshuffle the bar every time one moved.
 *
 * Pure CSS; renders in a server component.
 */
export function SegmentedBar({
  segments,
  ariaLabel,
  className,
}: {
  segments: Segment[];
  ariaLabel: string;
  className?: string;
}) {
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={ariaLabel}
      >
        {shown.map((s) => (
          <div
            key={s.label}
            className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-500"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      {/* Every segment is named beside its count. A bar of colours with the key
          somewhere else is a puzzle, and the counts are what people came for. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {shown.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
