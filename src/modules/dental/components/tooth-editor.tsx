"use client";

import { cn } from "@/core/lib/utils";
import type { ChartItemEditorProps } from "@/core/types/module";
import type { ChartTooth, ToothStatus } from "@/modules/dental/db/schema";
import { SURFACES, TOOTH_STATUSES, isRootTreated } from "@/modules/dental/tooth-status";

/**
 * The controls for ONE tooth — status, surfaces, root canal, note.
 *
 * Extracted from the odontogram's inline picker so the same controls serve both the
 * chart editor and "record a treatment" on the tooth's own panel. Two copies of the
 * tooth vocabulary would eventually disagree about what can be charted, and this is
 * also what keeps the vocabulary out of core: the panel that records a treatment is
 * specialty-agnostic and renders whatever editor the module hands it.
 *
 * Controlled — it holds no state and never saves. The caller decides whether a change
 * edits a chart in place or becomes a dated treatment record.
 */
export function ToothEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: ChartTooth | null;
  onChange: (next: ChartTooth) => void;
  disabled?: boolean;
}) {
  const sel = value;
  const status = sel?.status ?? "sound";
  const absent = status === "missing" || status === "unerupted";

  const set = (patch: Partial<ChartTooth>) =>
    onChange({ ...(sel ?? { status: "sound" }), ...patch } as ChartTooth);

  const toggleSurface = (s: string) => {
    const surfaces = new Set(sel?.surfaces ?? []);
    if (surfaces.has(s)) surfaces.delete(s);
    else surfaces.add(s);
    set({ surfaces: [...surfaces] });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {TOOTH_STATUSES.map((s) => (
          <button
            key={s.value}
            type="button"
            disabled={disabled}
            onClick={() => set({ status: s.value as ToothStatus })}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              status === s.value
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* A tooth that is not there has no surfaces to treat and no root to fill. */}
      {absent ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Surfaces:</span>
            {SURFACES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={disabled}
                onClick={() => toggleSurface(s)}
                className={cn(
                  "size-6 rounded border text-xs font-medium disabled:opacity-50",
                  sel?.surfaces?.includes(s)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Root treated is its own control, not another status, because it coexists
              with whatever restoration the tooth carries. Post and core go in the note. */}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              disabled={disabled}
              checked={isRootTreated(sel ?? undefined)}
              onChange={(e) => set({ endo: e.target.checked })}
              className="size-4 rounded border-input accent-primary"
            />
            <span>Root treated (endodontic)</span>
          </label>
        </>
      )}

      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">Note</span>
        <input
          type="text"
          disabled={disabled}
          value={sel?.note ?? ""}
          onChange={(e) => set({ note: e.target.value })}
          placeholder="Anything worth remembering about this tooth"
          className="h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      </label>
    </div>
  );
}

/** Contract wrapper — core passes the item's state as `unknown`. */
export function DentalToothEditor({ value, onChange, disabled }: ChartItemEditorProps) {
  return (
    <ToothEditor
      value={(value ?? null) as ChartTooth | null}
      onChange={(next) => onChange(next)}
      disabled={disabled}
    />
  );
}
