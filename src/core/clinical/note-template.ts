/**
 * The empty note a clinician TYPES into — CORE, pure (no DB, no `server-only`), so the
 * client form and the server action share it.
 *
 * WHY this exists: the note editor (`core/ui/note-editor.tsx`) renders whatever keys a
 * note already HAS, which suits an AI draft (the model fills the shape) and nothing
 * else. A typed note started as `{}`, so with the voice scribe off the form showed no
 * complaint, diagnosis or prescription to type into at all (owner's report,
 * 2026-11-18). A typed note now opens on its specialty's empty note
 * (`ModuleDefinition.blankNote`), or on this generic one when the specialty has none.
 */

/** Fields every specialty's visit note has, for a clinic whose module declares none. */
// No prescriptions here: a typed note enters its medicines in the prescription rows
// (`MedicineRow`, as on the patient's Prescriptions card), and the server writes them
// into the note (owner, 2026-11-18). No treatment performed / plan either — the owner
// asked for a free-text Clinical notes box instead.
export const GENERIC_BLANK_NOTE: Readonly<Record<string, unknown>> = {
  chiefComplaint: null,
  findings: [""],
  diagnosis: null,
  clinicalNotes: null,
  nextVisit: { reason: null, afterDays: null },
};

/** A fresh copy, so one form's edits never leak into the next. */
export function blankNoteFrom(template: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return structuredClone((template ?? GENERIC_BLANK_NOTE) as Record<string, unknown>);
}

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Drops what was left empty, so the rows a blank note opens with never reach the
 * record: an empty text becomes null, a list loses its empty rows, and a group whose
 * every field is empty becomes null (an untouched "Next visit" is no recall). Keys are
 * kept — a null diagnosis is still "no diagnosis", as on an AI draft.
 */
export function pruneEmptyNote(note: Record<string, unknown>): Record<string, unknown> {
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") return v.trim() === "" ? null : v;
    if (Array.isArray(v)) {
      return v.map(clean).filter((x) => !isBlank(x));
    }
    if (v && typeof v === "object") {
      const out = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clean(x)]));
      return Object.values(out).every(isBlank) ? null : out;
    }
    return v;
  };
  return Object.fromEntries(Object.entries(note).map(([k, v]) => [k, clean(v)]));
}
