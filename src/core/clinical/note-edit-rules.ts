/**
 * Editing a SAVED clinical note (owner, 2026-11-19) — the pure part, shared by the edit
 * form and the server action, and unit-tested (`scripts/test-note-edit.ts`). No DB, no
 * `server-only`.
 *
 * A saved note may be a dictated one (the AI's shape: medicines as `{ drug, dosage,
 * duration }`, sometimes treatment performed / plan) or a typed one (medicines carry
 * the full prescription line as `item`). Both open in the SAME form: the note's fields
 * in the generic editor, its medicines in the prescription rows.
 */
import { noteDrugToItem, type PrescriptionItem } from "@/core/lib/prescription-items";
import type { Medication } from "@/core/lib/medical-history";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The note as the edit form shows it: its medicines moved out into prescription rows,
 * and every field of the specialty's empty note it lacks added empty — so an older or
 * dictated note gets a Clinical notes box to add to (the "add notes" half of the
 * request). Fields the note already has are kept as they are, including ones the blank
 * note no longer offers (a dictated note's treatment performed stays editable).
 */
export function noteForEditing(
  note: unknown,
  template: Readonly<Record<string, unknown>>,
): { note: Record<string, unknown>; medicines: Medication[] } {
  const src = isObj(note) ? note : {};
  const { prescriptions, ...rest } = src;
  const out: Record<string, unknown> = { ...rest };
  for (const [k, v] of Object.entries(template)) {
    if (!(k in out) || out[k] === undefined) out[k] = structuredClone(v);
    // A null group (an untouched "Next visit" pruned on save) opens as its empty fields.
    else if (out[k] === null && isObj(v)) out[k] = structuredClone(v);
    // An empty list opens with one empty row to type into, like a new note.
    else if (Array.isArray(out[k]) && (out[k] as unknown[]).length === 0 && Array.isArray(v)) out[k] = structuredClone(v);
  }
  const medicines: Medication[] = medicineItems(prescriptions);
  return { note: out, medicines: medicines.length > 0 ? medicines : [{ name: "" }] };
}

/** A note's medicine lines as prescription lines (unreadable lines are dropped). */
export function medicineItems(prescriptions: unknown): PrescriptionItem[] {
  return (Array.isArray(prescriptions) ? prescriptions : [])
    .map(noteDrugToItem)
    .filter((i): i is PrescriptionItem => i !== null);
}

/** Order-sensitive, field-for-field — a reordered list is a changed prescription too. */
function sameItems(a: PrescriptionItem[], b: PrescriptionItem[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (i: PrescriptionItem) =>
    JSON.stringify(Object.keys(i).sort().filter((k) => (i as Record<string, unknown>)[k] !== undefined).map((k) => [k, (i as Record<string, unknown>)[k]]));
  return a.every((x, n) => norm(x) === norm(b[n]));
}

/**
 * Whether an edit changed the medicines. Only then is the patient's prescription made
 * from the note updated — so correcting a diagnosis never overwrites a prescription
 * the desk has since adjusted.
 */
export function medicinesChanged(before: unknown, after: unknown): boolean {
  const m = (n: unknown) => medicineItems(isObj(n) ? n.prescriptions : undefined);
  return !sameItems(m(before), m(after));
}

/** The note's next visit as a recall: `{ reason, afterDays }`, or null when there is none. */
export function nextVisitOf(note: unknown): { reason: string | null; afterDays: number } | null {
  const nv = isObj(note) ? note.nextVisit : null;
  if (!isObj(nv)) return null;
  const afterDays = Number(nv.afterDays);
  if (!Number.isFinite(afterDays) || afterDays <= 0) return null;
  return { reason: typeof nv.reason === "string" && nv.reason.trim() ? nv.reason : null, afterDays: Math.round(afterDays) };
}

/** Whether an edit changed the next visit (and so the recall it scheduled). */
export function nextVisitChanged(before: unknown, after: unknown): boolean {
  const a = nextVisitOf(before);
  const b = nextVisitOf(after);
  return (a?.afterDays ?? null) !== (b?.afterDays ?? null) || (a?.reason ?? null) !== (b?.reason ?? null);
}

/**
 * Which top-level fields an edit changed — for the activity log, which records the
 * field NAMES only (a note's text is patient data and never goes in a log, §10).
 */
export function changedNoteFields(before: unknown, after: unknown): string[] {
  const a = isObj(before) ? before : {};
  const b = isObj(after) ? after : {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const blank = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
  return [...keys]
    .filter((k) => {
      if (blank(a[k]) && blank(b[k])) return false;
      if (k === "prescriptions") return medicinesChanged(a, b);
      return JSON.stringify(a[k]) !== JSON.stringify(b[k]);
    })
    .sort();
}
