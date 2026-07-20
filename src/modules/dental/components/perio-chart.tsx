"use client";

import { cn } from "@/core/lib/utils";
import type {
  ClinicalVisitEditorProps,
  PatientChartProps,
} from "@/core/types/module";
import type { PerioTeeth, PerioTooth } from "@/modules/dental/db/schema";
import { ALL_PERMANENT, PERMANENT_LOWER, PERMANENT_UPPER } from "@/modules/dental/tooth-status";
import { examStats } from "@/modules/dental/perio-logic";

const SITE_LABELS = ["MB", "B", "DB", "ML", "L", "DL"]; // buccal 0-2, lingual 3-5
const MOB_FUR = ["0", "1", "2", "3"];

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const arr6 = (a?: (number | null)[]): (number | null)[] => {
  const out = (a ?? []).slice(0, 6);
  while (out.length < 6) out.push(null);
  return out;
};
const bool6 = (a?: boolean[]): boolean[] => {
  const out = (a ?? []).slice(0, 6);
  while (out.length < 6) out.push(false);
  return out;
};

/** Pocket depth cell colour: red for bleeding, amber for ≥5 mm. */
function pocketTone(pocket: number | null, bleeding: boolean): string {
  if (bleeding) return "text-red-700 dark:text-red-300 font-semibold";
  if (pocket != null && pocket >= 5) return "text-amber-700 dark:text-amber-300 font-semibold";
  return "";
}

function ToothRow({
  n,
  tooth,
  onChange,
}: {
  n: string;
  tooth: PerioTooth | undefined;
  onChange?: (patch: PerioTooth) => void;
}) {
  const pockets = arr6(tooth?.pockets);
  const recession = arr6(tooth?.recession);
  const bleeding = bool6(tooth?.bleeding);
  const readOnly = !onChange;

  const setPocket = (i: number, v: number | null) => {
    const next = arr6(tooth?.pockets);
    next[i] = v;
    onChange?.({ ...tooth, pockets: next, recession, bleeding });
  };
  const toggleBleed = (i: number) => {
    const next = bool6(tooth?.bleeding);
    next[i] = !next[i];
    onChange?.({ ...tooth, pockets, recession, bleeding: next });
  };

  const site = (i: number) => (
    <td key={i} className={cn("px-0.5 text-center", i === 2 && "border-r")}>
      {readOnly ? (
        <span className={cn("tabular-nums", pocketTone(pockets[i], bleeding[i]))}>
          {pockets[i] ?? "·"}
        </span>
      ) : (
        <div className="flex flex-col items-center gap-0.5">
          <input
            type="number"
            min={0}
            max={15}
            value={pockets[i] ?? ""}
            onChange={(e) => setPocket(i, e.target.value === "" ? null : Number(e.target.value))}
            className={cn(
              "h-6 w-8 rounded border border-input bg-[var(--input-bg)] text-center text-xs outline-none focus-visible:border-ring",
              pocketTone(pockets[i], bleeding[i]),
            )}
          />
          <button
            type="button"
            aria-label={`Bleeding ${SITE_LABELS[i]} on ${n}`}
            onClick={() => toggleBleed(i)}
            className={cn(
              "size-2.5 rounded-full border",
              bleeding[i] ? "border-red-600 bg-red-500" : "border-input",
            )}
          />
        </div>
      )}
    </td>
  );

  return (
    <tr className="border-b last:border-0">
      <td className="px-1 py-1 text-center text-xs font-medium tabular-nums">{n}</td>
      {[0, 1, 2, 3, 4, 5].map(site)}
      <td className="px-1 text-center">
        {readOnly ? (
          <span className="text-xs tabular-nums">{tooth?.mobility ?? "·"}</span>
        ) : (
          <select
            value={tooth?.mobility ?? ""}
            onChange={(e) => onChange?.({ ...tooth, mobility: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="h-6 rounded border border-input bg-[var(--input-bg)] text-xs outline-none"
          >
            <option value="">·</option>
            {MOB_FUR.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </td>
      <td className="px-1 text-center">
        {readOnly ? (
          <span className="text-xs tabular-nums">{tooth?.furcation ?? "·"}</span>
        ) : (
          <select
            value={tooth?.furcation ?? ""}
            onChange={(e) => onChange?.({ ...tooth, furcation: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="h-6 rounded border border-input bg-[var(--input-bg)] text-xs outline-none"
          >
            <option value="">·</option>
            {MOB_FUR.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}
      </td>
    </tr>
  );
}

/**
 * The periodontal chart — 6 sites per tooth (MB/B/DB buccal, ML/L/DL lingual):
 * pocket depths (mm), bleeding-on-probing dots, mobility + furcation (0–3).
 * Controlled by `value`; `onChange` makes it editable. Read-only shows only charted
 * teeth; the editor shows all permanent teeth.
 */
export function PerioChart({
  value,
  onChange,
}: {
  value: PerioTeeth;
  onChange?: (next: PerioTeeth) => void;
}) {
  const readOnly = !onChange;
  const stats = examStats(value);
  const rows = readOnly ? ALL_PERMANENT.filter((n) => value[n]) : ALL_PERMANENT;

  const setTooth = (n: string, patch: PerioTooth) => {
    onChange?.({ ...value, [n]: patch });
  };

  const Table = ({ teeth }: { teeth: string[] }) => (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-[10px] text-muted-foreground">
          <th className="px-1 pb-1 font-normal">Tooth</th>
          {SITE_LABELS.map((s, i) => (
            <th key={s} className={cn("px-0.5 pb-1 font-normal", i === 2 && "border-r")}>{s}</th>
          ))}
          <th className="px-1 pb-1 font-normal">Mob</th>
          <th className="px-1 pb-1 font-normal">Fur</th>
        </tr>
      </thead>
      <tbody>
        {teeth.map((n) => (
          <ToothRow key={n} n={n} tooth={value[n]} onChange={readOnly ? undefined : (patch) => setTooth(n, patch)} />
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span><span className="text-muted-foreground">BOP: </span><span className="font-semibold tabular-nums">{stats.bop}%</span></span>
        <span><span className="text-muted-foreground">Deepest: </span><span className="tabular-nums">{stats.maxPocket} mm</span></span>
        <span><span className="text-muted-foreground">Sites ≥5mm: </span><span className="tabular-nums">{stats.sitesOver5}</span></span>
        <span><span className="text-muted-foreground">Teeth charted: </span><span className="tabular-nums">{stats.chartedTeeth}</span></span>
      </div>

      {readOnly && rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No periodontal chart recorded.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border p-2">
          <p className="mb-1 text-[10px] font-medium text-muted-foreground">Upper</p>
          <Table teeth={readOnly ? PERMANENT_UPPER.filter((n) => value[n]) : PERMANENT_UPPER} />
          <p className="mb-1 mt-3 text-[10px] font-medium text-muted-foreground">Lower</p>
          <Table teeth={readOnly ? PERMANENT_LOWER.filter((n) => value[n]) : PERMANENT_LOWER} />
        </div>
      )}
      {!readOnly ? (
        <p className="text-[11px] text-muted-foreground">
          Enter pocket depth (mm) per site; tap the dot to mark bleeding. Mob/Fur = mobility/furcation (0–3).
        </p>
      ) : null}
    </div>
  );
}

// ─── contract wrappers ──────────────────────────────────────────────────────

export function DentalPerioEditor({ value, onChange }: ClinicalVisitEditorProps) {
  return <PerioChart value={(value ?? {}) as PerioTeeth} onChange={(next) => onChange(next)} />;
}

export function DentalPerioChart({ chart }: PatientChartProps) {
  return <PerioChart value={(chart ?? {}) as PerioTeeth} />;
}
