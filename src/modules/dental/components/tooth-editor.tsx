"use client";

import { cn } from "@/core/lib/utils";
import type { ChartItemEditorProps } from "@/core/types/module";
import type { ChartTooth, ToothCondition, ToothStatus } from "@/modules/dental/db/schema";
import {
  ABSENT_STATUSES,
  MAIN_TOOTH_STATUSES,
  SURFACES,
  ROOT_CANAL_LABEL,
  TOOTH_CONDITIONS,
  TOOTH_HINTS,
  allowedOn,
  normalizeTooth,
} from "@/modules/dental/tooth-status";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import {
  CONDITION_DOT,
  ENDO_BAR,
  SOUND_CLASS,
  STATUS_CLASS,
} from "@/modules/dental/components/tooth-colors";

/**
 * The controls for ONE tooth — what it is, its conditions, surfaces, note.
 *
 * Extracted from the odontogram's inline picker so the same controls serve both the
 * chart editor and "record a treatment" on the tooth's own panel. Two copies of the
 * tooth vocabulary would eventually disagree about what can be charted, and this is
 * also what keeps the vocabulary out of core: the panel that records a treatment is
 * specialty-agnostic and renders whatever editor the module hands it.
 *
 * ONE status ("what the tooth is") plus any number of conditions (owner's call,
 * 2026-10-15) — a crown with caries at the margin, root treated, being watched. The
 * rules live in `tooth-status.ts` and are applied as you click: picking Missing clears
 * everything that cannot be on a missing tooth, and picking Implant clears root
 * treated and caries, so the form can never show an impossible tooth. The server
 * checks the same rules.
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
  // Read older charts (a "caries" or "root_canal" status) in the current shape.
  const sel = value ? normalizeTooth(value) : null;
  const status = sel?.status ?? "sound";
  const absent = ABSENT_STATUSES.has(status);

  const emit = (t: ChartTooth) => {
    const next = { ...t };
    if (!next.conditions?.length) delete next.conditions;
    if (!next.surfaces?.length) delete next.surfaces;
    if (!next.endo) delete next.endo;
    onChange(next);
  };
  const set = (patch: Partial<ChartTooth>) =>
    emit({ ...(sel ?? { status: "sound" }), ...patch } as ChartTooth);

  /** Changing what the tooth is drops whatever the new status cannot carry. */
  const setStatus = (next: ToothStatus) => {
    const base: ChartTooth = { ...(sel ?? { status: "sound" }), status: next };
    if (ABSENT_STATUSES.has(next)) {
      emit({ ...base, conditions: [], endo: false, surfaces: [] });
      return;
    }
    emit({
      ...base,
      conditions: (base.conditions ?? []).filter((c) => allowedOn(next, c)),
      endo: Boolean(base.endo) && allowedOn(next, "endo"),
    });
  };

  const toggleCondition = (c: ToothCondition) => {
    const has = new Set(sel?.conditions ?? []);
    if (has.has(c)) has.delete(c);
    else has.add(c);
    set({ conditions: TOOTH_CONDITIONS.map((x) => x.value).filter((x) => has.has(x)) });
  };

  const toggleSurface = (s: string) => {
    const surfaces = new Set(sel?.surfaces ?? []);
    if (surfaces.has(s)) surfaces.delete(s);
    else surfaces.add(s);
    set({ surfaces: [...surfaces] });
  };

  const endoOk = allowedOn(status, "endo");
  const implantNote = status === "implant";

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium">1. What is the tooth now? <span className="font-normal text-muted-foreground">Choose one</span></legend>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {MAIN_TOOTH_STATUSES.map((s) => (
            <ChoiceCard
              key={s.value}
              selected={status === s.value}
              disabled={disabled}
              onClick={() => setStatus(s.value)}
              swatch={<span className={cn("size-3.5 shrink-0 rounded-sm border", s.value === "sound" ? SOUND_CLASS : STATUS_CLASS[s.value])} />}
              label={s.label}
              hint={TOOTH_HINTS[s.value]}
              role="radio"
            />
          ))}
        </div>
      </fieldset>

      {/* Nothing can be ON a tooth that is not there, so the rest is not offered. */}
      {absent ? (
        <p className="text-xs text-muted-foreground">
          The tooth isn&apos;t there, so there is nothing else to mark on it.
        </p>
      ) : (
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">
              2. Anything else on this tooth? <span className="font-normal text-muted-foreground">Tick all that apply, or none</span>
            </legend>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {TOOTH_CONDITIONS.map((c) => (
                <ChoiceCard
                  key={c.value}
                  selected={Boolean(sel?.conditions?.includes(c.value))}
                  disabled={disabled || !allowedOn(status, c.value)}
                  onClick={() => toggleCondition(c.value)}
                  swatch={<span className={cn("size-2.5 shrink-0 rounded-full", CONDITION_DOT[c.value])} />}
                  label={c.label}
                  hint={TOOTH_HINTS[c.value]}
                  role="checkbox"
                />
              ))}
              {/* Root canal sits with these because it goes WITH whatever the tooth
                  is — a crowned tooth can have one. Drawn as the same violet bar the
                  chart puts under the tooth. Post and core go in the note. */}
              <ChoiceCard
                selected={Boolean(sel?.endo)}
                disabled={disabled || !endoOk}
                onClick={() => set({ endo: !sel?.endo })}
                swatch={<span className={cn("size-3.5 shrink-0 rounded-sm border bg-violet-100 dark:bg-violet-950", ENDO_BAR)} />}
                label={ROOT_CANAL_LABEL}
                hint={TOOTH_HINTS.endo}
                role="checkbox"
              />
            </div>
            {implantNote ? (
              <p className="text-[11px] text-muted-foreground">
                An implant has no natural root or enamel, so Caries and Root canal don&apos;t apply.
              </p>
            ) : null}
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">
              3. Which sides? <span className="font-normal text-muted-foreground">Optional</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {SURFACES.map((s) => {
                const on = Boolean(sel?.surfaces?.includes(s));
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => toggleSurface(s)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs disabled:opacity-50",
                      on ? "border-primary bg-primary/10 font-medium ring-1 ring-primary" : "hover:bg-accent",
                    )}
                  >
                    <span className="font-semibold">{s}</span> <span className="text-muted-foreground">{SURFACE_NAMES[s]}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        </>
      )}

      <label className="block space-y-1">
        <span className="block text-xs font-medium">Note <span className="font-normal text-muted-foreground">Optional</span></span>
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

/** The sides of a tooth, in words — the letters alone mean nothing to the front desk. */
const SURFACE_NAMES: Record<string, string> = {
  M: "towards the front",
  D: "towards the back",
  O: "biting top",
  B: "cheek side",
  L: "tongue side",
};

/**
 * One choice in the panel: the SAME colour mark the chart and legend use, the name,
 * and a plain line saying what it means. Selected = a teal outline and a tick, never a
 * solid fill — a fill would hide the colour, and the colour is how the choice is
 * matched to the chart.
 */
function ChoiceCard({
  selected,
  disabled,
  onClick,
  swatch,
  label,
  hint,
  role,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  swatch: ReactNode;
  label: string;
  hint?: string;
  role: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        selected ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-accent",
      )}
    >
      <span className="mt-0.5" aria-hidden="true">{swatch}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium leading-tight">{label}</span>
        {hint ? <span className="block text-[11px] leading-tight text-muted-foreground">{hint}</span> : null}
      </span>
      {selected ? <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
    </button>
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
