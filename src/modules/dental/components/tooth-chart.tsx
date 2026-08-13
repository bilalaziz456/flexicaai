"use client";

import { useState } from "react";
import { cn } from "@/core/lib/utils";
import type {
  ClinicalVisitEditorProps,
  PatientChartProps,
} from "@/core/types/module";
import type { ChartTeeth, ChartTooth, ToothStatus } from "@/modules/dental/db/schema";
import {
  ALL_PRIMARY,
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
      aria-label={`Tooth ${n}${status ? `: ${statusLabel(status)}` : ""}${
        tooth?.note?.trim() ? `. Note: ${tooth.note.trim()}` : ""
      }`}
      title={
        (status
          ? `${n}: ${statusLabel(status)}${tooth?.surfaces?.length ? ` (${tooth.surfaces.join("")})` : ""}`
          : n) + (tooth?.note?.trim() ? `\n${tooth.note.trim()}` : "")
      }
      className={cn(
        "flex w-8 shrink-0 flex-col items-center rounded-md border py-1 text-[10px] leading-tight transition-colors",
        toneFor(status),
        onClick && "cursor-pointer hover:ring-1 hover:ring-primary/50",
        selected && "ring-2 ring-primary",
      )}
    >
      <span className="tabular-nums opacity-60">{n}</span>
      <span className="min-h-3 font-semibold">
        {abbr || " "}
        {/* A dot marks a tooth carrying a note, so the grid shows there is more to
            read without the note needing to fit in an 8px-wide cell. */}
        {tooth?.note?.trim() ? <span aria-hidden="true"> ·</span> : null}
      </span>
    </button>
  );
}

/**
 * One arch row, split at the FDI midline for a natural odontogram gap.
 *
 * The two quadrants WRAP when there isn't room for both. A full arch is 557px wide,
 * but the printable width is 278px on an 80mm thermal roll and 482px on A5, and the
 * arch used to sit in a horizontal scroller — which scrolls on screen but simply
 * CLIPS on paper. Thermal lost 8 of the 16 teeth in every arch, A5 lost 2, and
 * nothing said so. Wrapping to quadrants fits every format, and because it is plain
 * responsive layout rather than a print-only rule, the preview on screen shows the
 * same thing the printer will produce.
 *
 * The midline is a gap rather than a 1px rule: as a flex item the rule stranded
 * itself on its own line once the halves wrapped. Every cell carries its FDI number,
 * so the gap is enough to read the arch by.
 */
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
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
      {/* The quadrants wrap internally too. A quadrant is 270px and the narrowest
          supported paper leaves 278px, so this never triggers in practice — but a
          chart that quietly drops teeth is the bug being fixed here, and breaking the
          row awkwardly beats losing a molar on some future narrower stationery. */}
      <div className="flex flex-wrap justify-center gap-0.5">
        {left.map((n) => (
          <ToothCell key={n} n={n} tooth={teeth[n]} selected={selected === n} onClick={onSelect ? () => onSelect(n) : undefined} />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-0.5">
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
  const [pUL, pUR] = half(PRIMARY_UPPER);
  const [pLL, pLR] = half(PRIMARY_LOWER);

  // A charted primary tooth has to show itself. Reading the chart — on the patient
  // page or on a printed sheet — the baby dentition only ever appeared if you pressed
  // a toggle, and paper has no buttons, so a paediatric chart printed as though the
  // child had nothing recorded. Here both dentitions render whenever the primary one
  // holds anything. The editor keeps the toggle: charting is deliberate, and showing
  // 52 teeth to someone working on a permanent molar is just noise.
  const showsBothDentitions = readOnly && ALL_PRIMARY.some((n) => value[n]);

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
        {/* The toggle is an editor control. It was printing onto the sheet as a dead
            button, and in the read-only view it is now redundant anyway. */}
        {readOnly ? null : (
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
        )}
      </div>

      {/* Not `w-fit`: sizing to the 557px arch regardless of the container is exactly
          what stopped the quadrants from ever wrapping. */}
      <div>
        <div className="mx-auto max-w-full space-y-1.5">
          {showsBothDentitions ? <DentitionLabel>Permanent</DentitionLabel> : null}
          <ArchRow left={uL} right={uR} teeth={value} selected={selected} onSelect={readOnly ? undefined : setSelected} />
          <ArchRow left={lL} right={lR} teeth={value} selected={selected} onSelect={readOnly ? undefined : setSelected} />
          {showsBothDentitions ? (
            <>
              <DentitionLabel>Primary</DentitionLabel>
              <ArchRow left={pUL} right={pUR} teeth={value} selected={null} />
              <ArchRow left={pLL} right={pLR} teeth={value} selected={null} />
            </>
          ) : null}
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

          {/* Per-tooth note. `ChartTooth.note` already existed and was carried through
              every edit path, but nothing could set it. A note alone is enough to keep
              a tooth on the chart: `setTooth` only drops an entry when the status is
              sound AND there are no surfaces AND no note, so "sound but watch this"
              survives, and clearing the text drops it again. */}
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">Note</span>
            <input
              type="text"
              value={sel?.note ?? ""}
              onChange={(e) =>
                setTooth(selected, {
                  status: sel?.status ?? "sound",
                  surfaces: sel?.surfaces,
                  note: e.target.value,
                })
              }
              placeholder={`Anything worth remembering about tooth ${selected}`}
              className="h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
        </div>
      ) : null}

      <ChartNotes teeth={value} />

      <Legend teeth={value} />
    </div>
  );
}

/** Caption above an arch pair, shown only when both dentitions are on the chart. */
function DentitionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * The charted notes, listed under the odontogram.
 *
 * Without this a note is invisible once saved: the grid only has room for a status
 * abbreviation, so a note would live in the tooltip of a cell nobody thinks to hover.
 * Shown in both modes, so the person reading the chart sees the same thing as the
 * person who wrote it.
 */
function ChartNotes({ teeth }: { teeth: ChartTeeth }) {
  const noted = Object.entries(teeth)
    .filter(([, t]) => t.note?.trim())
    .sort(([a], [b]) => a.localeCompare(b));
  if (noted.length === 0) return null;
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground">Notes</p>
      <ul className="mt-1.5 space-y-1">
        {noted.map(([n, t]) => (
          <li key={n} className="flex gap-2 text-xs">
            <span className="shrink-0 font-medium tabular-nums">{n}</span>
            <span className="text-muted-foreground">{t.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact legend of the statuses actually present (keeps the chart readable). */
function Legend({ teeth }: { teeth: ChartTeeth }) {
  const present = new Set(Object.values(teeth).map((t) => t.status));
  const items = TOOTH_STATUSES.filter((s) => present.has(s.value));
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">No conditions charted. All teeth sound.</p>;
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
