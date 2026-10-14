"use client";

import { useState } from "react";
import { cn } from "@/core/lib/utils";
import type {
  ClinicalVisitEditorProps,
  PatientChartProps,
} from "@/core/types/module";
import type { ChartTeeth, ChartTooth, ToothStatus } from "@/modules/dental/db/schema";
import {
  autoDentition,
  type DentitionView,
  PERMANENT_LOWER,
  PERMANENT_UPPER,
  PRIMARY_LOWER,
  PRIMARY_UPPER,
  STATUS_BY_VALUE,
  TOOTH_CONDITIONS,
  TOOTH_STATUSES,
  normalizeTooth,
  ROOT_CANAL_LABEL,
  TOOTH_HINTS,
  toothLabel,
} from "@/modules/dental/tooth-status";
import { ToothEditor } from "@/modules/dental/components/tooth-editor";
import { CONDITION_DOT, ENDO_BAR, SOUND_CLASS, STATUS_CLASS } from "@/modules/dental/components/tooth-colors";

function toneFor(status?: ToothStatus): string {
  if (status === "sound") return SOUND_CLASS;
  return (status && STATUS_CLASS[status]) || SOUND_CLASS;
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
  // Older charts store a condition as the status; read them in the current shape.
  const t = tooth ? normalizeTooth(tooth) : undefined;
  const status = t?.status;
  const endo = Boolean(t?.endo);
  // A tooth whose only mark is a root canal still says so in words — the violet bar
  // alone was easy to miss, and "RCT" is what was printed before.
  const abbr = status && status !== "sound" ? STATUS_BY_VALUE[status]?.abbr : endo ? "RCT" : "";
  const conditions = t?.conditions ?? [];
  // Root canal reads as a bar under the crown — the root, marked the way a paper
  // chart marks it. A glyph would have to share an 8px-wide cell with the status
  // abbreviation and the note dot, and a bar survives a mono thermal print where a
  // colour would not.
  const endoMark = endo ? ENDO_BAR : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={`Tooth ${n}${t ? `: ${toothLabel(t)}` : ""}${
        tooth?.note?.trim() ? `. Note: ${tooth.note.trim()}` : ""
      }`}
      title={
        (t ? `${n}: ${toothLabel(t)}${t.surfaces?.length ? ` (${t.surfaces.join("")})` : ""}` : n) +
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
      {/* One dot per condition — several can sit on one tooth (a crown with caries
          that is being watched). Coloured by condition, keyed in the legend. */}
      {conditions.length ? (
        <span className="flex gap-0.5 pt-0.5" aria-hidden="true">
          {conditions.map((c) => (
            <span key={c} className={cn("size-1.5 rounded-full", CONDITION_DOT[c])} />
          ))}
        </span>
      ) : null}
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
  /** One selected tooth, or several (selecting a group to record on together). */
  selected: string | null | ReadonlySet<string>;
  onSelect?: (n: string) => void;
}) {
  const isSel = (n: string) => (typeof selected === "string" ? selected === n : Boolean(selected?.has(n)));
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
      {/* The quadrants wrap internally too. A quadrant is 270px and the narrowest
          supported paper leaves 278px, so this never triggers in practice — but a
          chart that quietly drops teeth is the bug being fixed here, and breaking the
          row awkwardly beats losing a molar on some future narrower stationery. */}
      <div className="flex flex-wrap justify-center gap-0.5">
        {left.map((n) => (
          <ToothCell key={n} n={n} tooth={teeth[n]} selected={isSel(n)} onClick={onSelect ? () => onSelect(n) : undefined} />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-0.5">
        {right.map((n) => (
          <ToothCell key={n} n={n} tooth={teeth[n]} selected={isSel(n)} onClick={onSelect ? () => onSelect(n) : undefined} />
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
  selectedTeeth,
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
  /** Several teeth selected at once (read-only chart only); wins over `selectedTooth`. */
  selectedTeeth?: readonly string[];
}) {
  const readSelection: string | null | ReadonlySet<string> = selectedTeeth ? new Set(selectedTeeth) : selectedTooth;
  const readOnly = !onChange;
  const [showPrimary, setShowPrimary] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chosenView, setChosenView] = useState<DentitionView | null>(null);

  const upper = showPrimary ? PRIMARY_UPPER : PERMANENT_UPPER;
  const lower = showPrimary ? PRIMARY_LOWER : PERMANENT_LOWER;
  const half = (row: string[]) => [row.slice(0, row.length / 2), row.slice(row.length / 2)] as const;
  const [uL, uR] = half(upper);
  const [lL, lR] = half(lower);
  const [pUL, pUR] = half(PRIMARY_UPPER);
  const [pLL, pLR] = half(PRIMARY_LOWER);

  // Which dentitions to draw. Nobody chooses on a printed sheet — paper has no
  // controls — so `auto` shows what is actually charted and the segmented control is
  // an on-screen override only. That is the guarantee: a child's teeth cannot be
  // absent from their own record because a button was left the wrong way.
  const auto = autoDentition(value);
  const view: DentitionView = readOnly ? (chosenView ?? auto) : showPrimary ? "primary" : "permanent";
  const showsPermanent = view === "permanent" || view === "mixed";
  const showsPrimary = view === "primary" || view === "mixed";
  // Captions only earn their place once both sets are up.
  const captionDentitions = showsPrimary && showsPermanent;

  const setTooth = (n: string, patch: Partial<ChartTooth> & { status: ToothStatus }) => {
    if (!onChange) return;
    const next = { ...value };
    // The editor sends the WHOLE tooth, so it replaces rather than merges: merging
    // would keep a condition or root treatment the user had just unticked (the editor
    // drops empty fields). "Sound and nothing else" is not worth an entry; a
    // condition or root treatment on a sound tooth is.
    const merged = { ...patch, ...(next[n]?.updatedVisitId ? { updatedVisitId: next[n].updatedVisitId } : {}) };
    if (merged.status === "sound" && !merged.surfaces?.length && !merged.note && !merged.endo && !merged.conditions?.length) {
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
        {/* Primary / Permanent / Mixed, like the period filter elsewhere. Rendered
            only when the chart is interactive: the print sheet passes no select
            handler, so paper gets the automatic choice and no dead buttons. */}
        {readOnly ? (
          onSelectTooth ? (
            <div
              className="flex w-fit overflow-hidden rounded-md border"
              role="group"
              aria-label="Which teeth to show"
            >
              {(["primary", "permanent", "mixed"] as const).map((v, i) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setChosenView(v)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    i > 0 && "border-l",
                    view === v ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          ) : null
        ) : (
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
            <ArchRow left={uL} right={uR} teeth={value} selected={readOnly ? readSelection : selected} onSelect={readOnly ? onSelectTooth : setSelected} />
            <ArchRow left={lL} right={lR} teeth={value} selected={readOnly ? readSelection : selected} onSelect={readOnly ? onSelectTooth : setSelected} />
          </>
        ) : null}
        {showsPrimary ? (
          <>
            {captionDentitions ? <DentitionLabel>Primary</DentitionLabel> : null}
            <ArchRow left={pUL} right={pUR} teeth={value} selected={readSelection} onSelect={onSelectTooth} />
            <ArchRow left={pLL} right={pLR} teeth={value} selected={readSelection} onSelect={onSelectTooth} />
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
  // Read in the current shape: what each tooth IS (a fill) and its conditions (dots).
  const all = Object.values(teeth).map((t) => normalizeTooth(t));
  const present = new Set(all.map((t) => t.status));
  const items = TOOTH_STATUSES.filter((s) => s.value !== "sound" && present.has(s.value));
  const conditionsPresent = new Set(all.flatMap((t) => t.conditions ?? []));
  const conditions = TOOTH_CONDITIONS.filter((c) => conditionsPresent.has(c.value));
  // The root-canal bar is the one mark on the chart that is not a fill or a dot, so it
  // has to be spelled out or it reads as a styling accident.
  const anyEndo = all.some((t) => t.endo);
  if (items.length === 0 && conditions.length === 0 && !anyEndo) {
    return <p className="text-xs text-muted-foreground">No conditions charted. All teeth sound.</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((s) => (
        <span key={s.value} className="inline-flex items-center gap-1" title={TOOTH_HINTS[s.value]}>
          <span className={cn("inline-block size-3 rounded-sm border", toneFor(s.value))} aria-hidden="true" />
          {s.label}
        </span>
      ))}
      {conditions.map((c) => (
        <span key={c.value} className="inline-flex items-center gap-1" title={TOOTH_HINTS[c.value]}>
          <span className={cn("inline-block size-2 rounded-full", CONDITION_DOT[c.value])} aria-hidden="true" />
          {c.label}
        </span>
      ))}
      {anyEndo ? (
        <span className="inline-flex items-center gap-1">
          <span className={cn("inline-block size-3 rounded-sm border bg-violet-100 dark:bg-violet-950", ENDO_BAR)} aria-hidden="true" />
          {ROOT_CANAL_LABEL}
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
export function DentalPatientChart({ chart, onSelectItem, selectedItem, selectedItems }: PatientChartProps) {
  return (
    <ToothChart
      value={(chart ?? {}) as ChartTeeth}
      onSelectTooth={onSelectItem}
      selectedTooth={selectedItem ?? null}
      selectedTeeth={selectedItems}
    />
  );
}
