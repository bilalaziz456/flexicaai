"use client";

import { useState } from "react";
import { cn } from "@/core/lib/utils";
import type {
  ClinicalVisitEditorProps,
  PatientChartProps,
} from "@/core/types/module";
import type { ChartTeeth, ChartTooth, ToothStatus } from "@/modules/dental/db/schema";
import {
  PERMANENT_LOWER,
  PERMANENT_UPPER,
  PRIMARY_LOWER,
  PRIMARY_UPPER,
  STATUS_BY_VALUE,
  SURFACES,
  TOOTH_STATUSES,
  statusLabel,
} from "@/modules/dental/tooth-status";

/** Semantic tone → colour classes (light + dark). */
const TONE_CLASS: Record<string, string> = {
  neutral: "border-input bg-[var(--input-bg)] text-foreground",
  danger: "border-red-300 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  info: "border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300",
  success: "border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  muted: "border-dashed border-muted-foreground/50 bg-muted text-muted-foreground",
};

function toneFor(status?: ToothStatus): string {
  return TONE_CLASS[(status && STATUS_BY_VALUE[status]?.tone) || "neutral"];
}

function ToothCell({
  n,
  tooth,
  selected,
  onClick,
}: {
  n: string;
  tooth?: ChartTooth;
  selected: boolean;
  onClick?: () => void;
}) {
  const status = tooth?.status;
  const abbr = status ? STATUS_BY_VALUE[status]?.abbr : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={`Tooth ${n}${status ? ` — ${statusLabel(status)}` : ""}`}
      title={status ? `${n}: ${statusLabel(status)}${tooth?.surfaces?.length ? ` (${tooth.surfaces.join("")})` : ""}` : n}
      className={cn(
        "flex w-8 shrink-0 flex-col items-center rounded-md border py-1 text-[10px] leading-tight transition-colors",
        toneFor(status),
        onClick && "cursor-pointer hover:ring-1 hover:ring-primary/50",
        selected && "ring-2 ring-primary",
      )}
    >
      <span className="tabular-nums opacity-60">{n}</span>
      <span className="min-h-3 font-semibold">{abbr || " "}</span>
    </button>
  );
}

/** One arch row, split at the FDI midline for a natural odontogram gap. */
function ArchRow({
  left,
  right,
  teeth,
  selected,
  onSelect,
}: {
  left: string[];
  right: string[];
  teeth: ChartTeeth;
  selected: string | null;
  onSelect?: (n: string) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      <div className="flex gap-0.5">
        {left.map((n) => (
          <ToothCell key={n} n={n} tooth={teeth[n]} selected={selected === n} onClick={onSelect ? () => onSelect(n) : undefined} />
        ))}
      </div>
      <div className="h-8 w-px bg-border" aria-hidden="true" />
      <div className="flex gap-0.5">
        {right.map((n) => (
          <ToothCell key={n} n={n} tooth={teeth[n]} selected={selected === n} onClick={onSelect ? () => onSelect(n) : undefined} />
        ))}
      </div>
    </div>
  );
}

/**
 * The FDI odontogram. Controlled by `value` (ChartTeeth). Pass `onChange` for the
 * editor; omit it for a read-only chart. A "Primary teeth" toggle reveals the baby
 * dentition (paediatric). Selecting a tooth (editor) opens an inline picker below.
 */
export function ToothChart({
  value,
  onChange,
}: {
  value: ChartTeeth;
  onChange?: (next: ChartTeeth) => void;
}) {
  const readOnly = !onChange;
  const [showPrimary, setShowPrimary] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const upper = showPrimary ? PRIMARY_UPPER : PERMANENT_UPPER;
  const lower = showPrimary ? PRIMARY_LOWER : PERMANENT_LOWER;
  const half = (row: string[]) => [row.slice(0, row.length / 2), row.slice(row.length / 2)] as const;
  const [uL, uR] = half(upper);
  const [lL, lR] = half(lower);

  const setTooth = (n: string, patch: Partial<ChartTooth> & { status: ToothStatus }) => {
    if (!onChange) return;
    const next = { ...value };
    if (patch.status === "sound" && !patch.surfaces?.length && !patch.note) {
      delete next[n]; // sound + nothing = no entry
    } else {
      next[n] = { ...next[n], ...patch };
    }
    onChange(next);
  };

  const toggleSurface = (n: string, s: string) => {
    const cur = value[n];
    if (!cur) return;
    const surfaces = new Set(cur.surfaces ?? []);
    if (surfaces.has(s)) surfaces.delete(s);
    else surfaces.add(s);
    setTooth(n, { status: cur.status, surfaces: [...surfaces], note: cur.note });
  };

  const sel = selected ? value[selected] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">FDI numbering</p>
        <button
          type="button"
          onClick={() => {
            setShowPrimary((v) => !v);
            setSelected(null);
          }}
          className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
        >
          {showPrimary ? "Permanent teeth" : "Primary teeth"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="mx-auto w-fit space-y-1.5">
          <ArchRow left={uL} right={uR} teeth={value} selected={selected} onSelect={readOnly ? undefined : setSelected} />
          <ArchRow left={lL} right={lR} teeth={value} selected={selected} onSelect={readOnly ? undefined : setSelected} />
        </div>
      </div>

      {/* Editor: the picker for the selected tooth. */}
      {!readOnly && selected ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Tooth {selected}</span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              Done
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TOOTH_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setTooth(selected, { status: s.value, surfaces: sel?.surfaces, note: sel?.note })}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                  sel?.status === s.value || (!sel && s.value === "sound")
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          {sel && sel.status !== "missing" && sel.status !== "unerupted" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Surfaces:</span>
              {SURFACES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSurface(selected, s)}
                  className={cn(
                    "size-6 rounded border text-xs font-medium",
                    sel.surfaces?.includes(s) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <Legend teeth={value} />
    </div>
  );
}

/** Compact legend of the statuses actually present (keeps the chart readable). */
function Legend({ teeth }: { teeth: ChartTeeth }) {
  const present = new Set(Object.values(teeth).map((t) => t.status));
  const items = TOOTH_STATUSES.filter((s) => present.has(s.value));
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No conditions charted — all teeth sound.</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((s) => (
        <span key={s.value} className="inline-flex items-center gap-1">
          <span className={cn("inline-block size-3 rounded-sm border", toneFor(s.value))} aria-hidden="true" />
          {s.label}
        </span>
      ))}
    </div>
  );
}

// ─── clinicalRecord wrappers (match the core contract; props are `unknown`) ──

/** Editor bundle — the tooth chart as a visit's structured editor. */
export function DentalVisitEditor({ value, onChange }: ClinicalVisitEditorProps) {
  return (
    <ToothChart
      value={(value ?? {}) as ChartTeeth}
      onChange={(next) => onChange(next)}
    />
  );
}

/** Read-only bundle — the patient's current odontogram. */
export function DentalPatientChart({ chart }: PatientChartProps) {
  return <ToothChart value={(chart ?? {}) as ChartTeeth} />;
}
