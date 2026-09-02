/**
 * FDI tooth numbering + the tooth-status vocabulary — PURE (no DB, no server-only),
 * so both the client odontogram and the server fold logic share one source of truth.
 * FDI ("ISO 3950") is the PK/GCC norm and matches the scribe prompt.
 */
import type { ChartTeeth, ChartTooth, ToothStatus } from "@/modules/dental/db/schema";

/**
 * Is this tooth root-treated?
 *
 * Reads the `endo` flag OR the legacy `root_canal` status, which is what charts
 * recorded before `endo` existed and still means the same thing. Keeping the status
 * value lets every chart written earlier display correctly without rewriting anyone's
 * clinical data; it now reads as "root-treated, no restoration recorded".
 *
 * Here rather than beside `ChartTooth` in `db/schema.ts` because the client
 * odontogram calls it: schema.ts evaluates `pgTable(...)` at module scope, so a
 * runtime import of it from a "use client" component drags drizzle into the browser
 * bundle. This file is pure by contract, which is the whole reason it exists.
 */
export function isRootTreated(tooth?: ChartTooth): boolean {
  return !!tooth && (tooth.endo === true || tooth.status === "root_canal");
}

/** Odontogram rows, left→right as drawn. Permanent + primary (baby) dentition. */
export const PERMANENT_UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
export const PERMANENT_LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
export const PRIMARY_UPPER = ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"];
export const PRIMARY_LOWER = ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"];

export const ALL_PERMANENT = [...PERMANENT_UPPER, ...PERMANENT_LOWER];
export const ALL_PRIMARY = [...PRIMARY_UPPER, ...PRIMARY_LOWER];
const ALL_TEETH = new Set([...ALL_PERMANENT, ...ALL_PRIMARY]);

/** Is this a valid FDI tooth number? */
export function isToothNumber(n: string): boolean {
  return ALL_TEETH.has(n);
}

/** Primary (baby) teeth are FDI quadrants 5–8. */
export function isPrimaryTooth(n: string): boolean {
  return /^[5-8]/.test(n);
}

/** Tooth surfaces (FDI): mesial, distal, occlusal/incisal, buccal/facial, lingual/palatal. */
export const SURFACES = ["M", "D", "O", "B", "L"] as const;

/**
 * The tooth-status vocabulary. `tone` is a neutral colour token the odontogram maps
 * to fill/text; `abbr` is the short mark drawn on the tooth. Order = the picker order.
 */
export const TOOTH_STATUSES = [
  { value: "sound", label: "Sound", tone: "neutral", abbr: "" },
  { value: "caries", label: "Caries", tone: "danger", abbr: "C" },
  { value: "filled", label: "Filled", tone: "info", abbr: "F" },
  { value: "root_canal", label: "Root canal", tone: "warning", abbr: "RCT" },
  { value: "crown", label: "Crown", tone: "success", abbr: "Cr" },
  { value: "bridge_abutment", label: "Bridge abutment", tone: "success", abbr: "Br" },
  { value: "bridge_pontic", label: "Bridge pontic", tone: "success", abbr: "Po" },
  { value: "veneer", label: "Veneer", tone: "info", abbr: "V" },
  { value: "sealant", label: "Sealant", tone: "info", abbr: "S" },
  { value: "implant", label: "Implant", tone: "success", abbr: "Im" },
  { value: "fractured", label: "Fractured", tone: "danger", abbr: "Fx" },
  { value: "to_extract", label: "To extract", tone: "danger", abbr: "X" },
  { value: "missing", label: "Missing", tone: "muted", abbr: "—" },
  // Shed naturally, which is NOT the same fact as missing. A primary tooth that
  // fell out on schedule and one that was extracted read identically otherwise, and
  // for a child those are completely different things. It is also what lets a
  // dentition retire itself once every tooth in it has gone.
  { value: "exfoliated", label: "Exfoliated (shed)", tone: "muted", abbr: "Ex" },
  { value: "unerupted", label: "Unerupted", tone: "muted", abbr: "U" },
  { value: "watch", label: "Watch", tone: "warning", abbr: "!" },
] as const satisfies readonly {
  value: ToothStatus;
  label: string;
  /** Semantic tone -> the chart maps this to a colour (works in light + dark). */
  tone: "neutral" | "danger" | "info" | "success" | "warning" | "muted";
  abbr: string;
}[];

/**
 * Every `ToothStatus` must appear in TOOTH_STATUSES above -- a COMPILE error if not.
 *
 * The vocabulary is declared twice by necessity: the union in `db/schema.ts` is the
 * jsonb column's type, while this array carries the label, tone and abbreviation the
 * chart draws. Collapsing them would make the two modules import each other, so they
 * are made provably in step instead. Without this, adding a status to the union and
 * forgetting the array COMPILED -- `STATUS_BY_VALUE` is built with an `as` cast, which
 * hides the gap -- and the tooth then rendered with no colour and its raw code as the
 * label. Silent, and visible only on a chart someone happened to open.
 */
type MissingToothStatus = Exclude<ToothStatus, (typeof TOOTH_STATUSES)[number]["value"]>;
const _everyToothStatusHasAnEntry = true as MissingToothStatus extends never
  ? true
  : MissingToothStatus;
void _everyToothStatusHasAnEntry;

export const STATUS_BY_VALUE: Record<ToothStatus, (typeof TOOTH_STATUSES)[number]> =
  Object.fromEntries(TOOTH_STATUSES.map((s) => [s.value, s])) as Record<
    ToothStatus,
    (typeof TOOTH_STATUSES)[number]
  >;

/** Label for a status value (fallback to the raw value). */
export function statusLabel(v: string): string {
  return STATUS_BY_VALUE[v as ToothStatus]?.label ?? v;
}

/** Which dentition(s) the odontogram is drawing. */
export type DentitionView = "primary" | "permanent" | "mixed";

/**
 * Does this dentition still have anything worth drawing?
 *
 * A tooth that has EXFOLIATED is gone and is not coming back, so once every primary
 * tooth on a chart has shed, the primary arches say nothing about the patient in
 * front of you — the shedding itself stays in each tooth's history. This is what
 * makes the move from mixed to permanent dentition look after itself: the arches
 * retire as the last tooth goes, with no age check and no manual tidy-up.
 *
 * `missing` deliberately does NOT count as gone. A missing permanent tooth is a gap
 * a dentist needs to see.
 */
export function dentitionInUse(teeth: ChartTeeth, numbers: readonly string[]): boolean {
  return numbers.some((n) => teeth[n] && teeth[n].status !== "exfoliated");
}

/**
 * Which dentitions to draw when nobody has chosen — show what is actually charted.
 * Falls back to permanent so an empty chart is a usable blank adult form.
 */
export function autoDentition(teeth: ChartTeeth): DentitionView {
  const perm = dentitionInUse(teeth, ALL_PERMANENT);
  const prim = dentitionInUse(teeth, ALL_PRIMARY);
  if (perm && prim) return "mixed";
  if (prim) return "primary";
  return "permanent";
}
