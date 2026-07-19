/**
 * FDI tooth numbering + the tooth-status vocabulary — PURE (no DB, no server-only),
 * so both the client odontogram and the server fold logic share one source of truth.
 * FDI ("ISO 3950") is the PK/GCC norm and matches the scribe prompt.
 */
import type { ToothStatus } from "@/modules/dental/db/schema";

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
export const TOOTH_STATUSES: {
  value: ToothStatus;
  label: string;
  /** Semantic tone → the chart maps this to a colour (works in light + dark). */
  tone: "neutral" | "danger" | "info" | "success" | "warning" | "muted";
  abbr: string;
}[] = [
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
  { value: "unerupted", label: "Unerupted", tone: "muted", abbr: "U" },
  { value: "watch", label: "Watch", tone: "warning", abbr: "!" },
];

export const STATUS_BY_VALUE: Record<ToothStatus, (typeof TOOTH_STATUSES)[number]> =
  Object.fromEntries(TOOTH_STATUSES.map((s) => [s.value, s])) as Record<
    ToothStatus,
    (typeof TOOTH_STATUSES)[number]
  >;

/** Label for a status value (fallback to the raw value). */
export function statusLabel(v: string): string {
  return STATUS_BY_VALUE[v as ToothStatus]?.label ?? v;
}
