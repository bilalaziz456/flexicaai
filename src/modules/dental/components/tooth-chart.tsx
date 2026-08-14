"use client";

import { useState } from "react";
import { cn } from "@/core/lib/utils";
import type {
  ClinicalVisitEditorProps,
  PatientChartProps,
} from "@/core/types/module";
import type { ChartTeeth, ChartTooth, ToothStatus } from "@/modules/dental/db/schema";
import {
  ALL_PERMANENT,
  ALL_PRIMARY,
  PERMANENT_LOWER,
  PERMANENT_UPPER,
  PRIMARY_LOWER,
  PRIMARY_UPPER,
  STATUS_BY_VALUE,
  isRootTreated,
  TOOTH_STATUSES,
  statusLabel,
} from "@/modules/dental/tooth-status";
import { ToothEditor } from "@/modules/dental/components/tooth-editor";

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
  const endo = isRootTreated(tooth);
  // Root canal reads as a bar under the crown — the root, marked the way a paper
  // chart marks it. A glyph would have to share an 8px-wide cell with the status
  // abbreviation and the note dot, and a bar survives a mono thermal print where a
  // colour would not.
  const endoMark = endo ? "border-b-[3px] border-b-current" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={`Tooth ${n}${status ? `: ${statusLabel(status)}` : ""}${
        endo ? ". Root treated" : ""
      }${tooth?.note?.trim() ? `. Note: ${tooth.note.trim()}` : ""}`}
      title={
        (status
          ? `${n}: ${statusLabel(status)}${tooth?.surfaces?.length ? ` (${tooth.surfaces.join("")})` : ""}`
          : n) +
        (endo ? "\nRoot treated" : "") +
        (tooth?.note?.trim() ? `\n${tooth.note.trim()}` : "")
      }
      className={cn(
        "flex w-8 shrink-0 flex-col items-center rounded-md border py-1 text-[10px] leading-tight transition-colors",
        toneFor(status),
        endoMark,
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
  onSelectTooth,
  selectedTooth = null,
}: {
  value: ChartTeeth;
  onChange?: (next: ChartTeeth) => void;
  /**
   * Read-only only: make teeth clickable to open that tooth's history. The print
   * sheet does NOT pass this, so the printed chart stays inert and history is not
   * printed.
   */
  onSelectTooth?: (tooth: string) => void;
  selectedTooth?: string | null;
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

  // Reading the chart — on the patient page or on a printed sheet — every dentition
  // that has something charted is shown, and nothing else. Paper has no controls, so
  // this must not depend on a toggle somebody could forget: a child's teeth would
  // silently be absent from their own record. An adult therefore sees the permanent
  // arches as before, a toddler sees only their primary ones instead of twenty teeth
  // buried under thirty-two blanks, and a six-to-twelve-year-old in mixed dentition
  // sees both on one sheet rather than needing two.
  //
  // A chart with nothing on it still draws the permanent arches, so a blank sheet is
  // a usable form rather than an empty box.
  //
  // The editor keeps the toggle. Charting a primary tooth that has nothing on it yet
  // means summoning a dentition this rule would hide, and there is a person present
  // to press the button.
  const hasPermanentCharted = ALL_PERMANENT.some((n) => value[n]);
  const hasPrimaryCharted = ALL_PRIMARY.some((n) => value[n]);
  const showsPrimary = readOnly && hasPrimaryCharted;
  const showsPermanent = !readOnly || hasPermanentCharted || !hasPrimaryCharted;
  // Captions only earn their place once the primary set is on the sheet; a plain
  // adult chart does not need to be told it is the permanent one.
  const captionDentitions = showsPrimary;

  const setTooth = (n: string, patch: Partial<ChartTooth> & { status: ToothStatus }) => {
    if (!onChange) return;
    const next = { ...value };
    // Decide on the MERGED tooth, not on the patch. The status buttons send only
    // status/surfaces/note, so judging the patch alone would read a root-treated
    // tooth as carrying nothing and delete it the moment someone set the status back
    // to sound — losing the root canal. "Sound and nothing else" is still not worth
    // an entry, but root-treated counts as something else.
    const merged = { ...next[n], ...patch };
    if (merged.status === "sound" && !merged.surfaces?.length && !merged.note && !merged.endo) {
      delete next[n];
    } else {
      next[n] = merged;
    }
    onChange(next);
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

      {/* Deliberately no width of its own. This used to be a `w-fit` box inside a
          horizontal scroller, which sized itself to the 557px arch whatever the paper
          was — that is what stopped the quadrants from ever wrapping, and what let the
          scroller clip them on print. The arches centre themselves. */}
      <div className="space-y-1.5">
        {showsPermanent ? (
          <>
            {captionDentitions ? <DentitionLabel>Permanent</DentitionLabel> : null}
            <ArchRow left={uL} right={uR} teeth={value} selected={readOnly ? selectedTooth : selected} onSelect={readOnly ? onSelectTooth : setSelected} />
            <ArchRow left={lL} right={lR} teeth={value} selected={readOnly ? selectedTooth : selected} onSelect={readOnly ? onSelectTooth : setSelected} />
          </>
        ) : null}
        {showsPrimary ? (
          <>
            {captionDentitions ? <DentitionLabel>Primary</DentitionLabel> : null}
            <ArchRow left={pUL} right={pUR} teeth={value} selected={selectedTooth} onSelect={onSelectTooth} />
            <ArchRow left={pLL} right={pLR} teeth={value} selected={selectedTooth} onSelect={onSelectTooth} />
          </>
        ) : null}
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
          <ToothEditor
            value={sel ?? null}
            onChange={(next: ChartTooth) => setTooth(selected, next)}
          />
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
  // The root-canal bar is the one mark on the chart that is not a colour, so it has
  // to be spelled out or it reads as a styling accident.
  const anyEndo = Object.values(teeth).some((t) => isRootTreated(t));
  if (items.length === 0 && !anyEndo) {
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
      {anyEndo ? (
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block size-3 rounded-sm border border-b-[3px] border-b-current"
            aria-hidden="true"
          />
          Root treated
        </span>
      ) : null}
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

/**
 * Read-only bundle — the patient's current odontogram.
 *
 * `onSelectItem` is what makes a tooth openable. The print sheet renders this same
 * component WITHOUT it, so the printed chart has no clickable teeth and no history,
 * which is how history stays off paper.
 */
export function DentalPatientChart({ chart, onSelectItem, selectedItem }: PatientChartProps) {
  return (
    <ToothChart
      value={(chart ?? {}) as ChartTeeth}
      onSelectTooth={onSelectItem}
      selectedTooth={selectedItem ?? null}
    />
  );
}
