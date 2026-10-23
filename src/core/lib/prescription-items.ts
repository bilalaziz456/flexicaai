/**
 * A typed PRESCRIPTION — what the doctor wrote, entered at the desk (owner's call,
 * 2026-10-14). PURE: the form, the server check and the PDF share it.
 *
 * A line is a medication in the same shape as the medical history's (name, dose,
 * type, frequency incl. a typed "2-2-2", duration, a short note such as "after meals")
 * — one vocabulary, so a medicine reads the same wherever it appears. Only `ongoing` is
 * left out: a prescription is for a stated duration.
 */
import { asMedication, describeMedication, type Medication } from "@/core/lib/medical-history";

export type PrescriptionItem = Omit<Medication, "ongoing">;

/** At most this many lines on one prescription — a typo guard, far above any real one. */
export const MAX_PRESCRIPTION_ITEMS = 30;
export const MAX_PRESCRIPTION_NOTES = 2000;

/** Checks and bounds what the browser sent; a line with no name is dropped. */
export function asPrescriptionItems(v: unknown): PrescriptionItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_PRESCRIPTION_ITEMS)
    .map(asMedication)
    .filter((m): m is Medication => m !== null && m.name.trim().length > 0)
    .map(({ ongoing: _o, ...item }) => ({ ...item, name: item.name.trim() }));
}

/** "Tablet / capsule (oral) · Twice daily (1-0-1) · for 5 days" — the line under the name. */
export function describePrescriptionItem(item: PrescriptionItem): string {
  return describeMedication(item);
}

/** Where a problem is, so the form can show it beside the field. `line` is 0-based. */
export type RxProblem = {
  field: "doctor" | "date" | "items" | "line" | "notes";
  line?: number;
  message: string;
};

const realDate = (ymd: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

/**
 * Everything a prescription must satisfy before it is saved — run by the FORM (to show
 * each problem beside its field) and again by the SERVER (a form is not a guarantee),
 * so the two can never disagree. `today` is YYYY-MM-DD in the clinic's time.
 *
 * A medicine row left completely empty is ignored (a spare "+ Medicine"); a row with
 * anything in it must name the medicine.
 */
export function checkPrescription(
  input: { doctorId: string | null | undefined; prescribedOn: string; items: Partial<Medication>[]; notes: string | null | undefined },
  today: string,
): RxProblem[] {
  const problems: RxProblem[] = [];
  if (!input.doctorId) problems.push({ field: "doctor", message: "Choose the doctor who prescribed it." });
  if (!realDate(input.prescribedOn)) problems.push({ field: "date", message: "Pick the date." });
  else if (input.prescribedOn > today) problems.push({ field: "date", message: "The date can't be in the future." });
  else if (input.prescribedOn < "2000-01-01") problems.push({ field: "date", message: "That date is too far back." });

  const filled = (m: Partial<Medication>) =>
    Boolean(
      (m.name ?? "").trim() || (m.dose ?? "").trim() || m.form || m.frequency || m.durationValue || (m.note ?? "").trim(),
    );
  let named = 0;
  input.items.forEach((m, i) => {
    if (!filled(m)) return;
    const n = i + 1;
    const name = (m.name ?? "").trim();
    if (!name) problems.push({ field: "line", line: i, message: `Medicine ${n}: enter the medicine's name.` });
    else if (name.length > 120) problems.push({ field: "line", line: i, message: `Medicine ${n}: the name is too long.` });
    else named++;
    if ((m.dose ?? "").length > 60) problems.push({ field: "line", line: i, message: `Medicine ${n}: the dose is too long.` });
    if (m.frequency === "other" && !(m.frequencyOther ?? "").trim()) {
      problems.push({ field: "line", line: i, message: `Medicine ${n}: type the frequency as written, e.g. 2-2-2.` });
    }
    if (m.durationValue !== undefined && (!Number.isInteger(m.durationValue) || m.durationValue < 1 || m.durationValue > 999)) {
      problems.push({ field: "line", line: i, message: `Medicine ${n}: the duration must be 1–999.` });
    }
    if ((m.note ?? "").length > 300) problems.push({ field: "line", line: i, message: `Medicine ${n}: the note is too long.` });
  });
  if (named === 0 && !problems.some((p) => p.field === "line")) {
    problems.push({ field: "items", message: "Add at least one medicine." });
  }
  if ((input.notes ?? "").length > MAX_PRESCRIPTION_NOTES) problems.push({ field: "notes", message: "The notes are too long." });
  return problems;
}

/**
 * A scribe note's medicine line (`{ drug, dosage, duration }`) as a prescription line,
 * so an approved note's medicines become a prescription that prints, downloads, edits
 * and deletes like a typed one (owner's call, 2026-10-24). "5 days" / "1 week" fill
 * the duration; any other duration wording is kept as the line's note rather than
 * lost. Migration 0135 applies the same rule to notes approved before this existed.
 */
export function noteDrugToItem(raw: unknown): PrescriptionItem | null {
  const d = (raw && typeof raw === "object" ? raw : {}) as { drug?: unknown; dosage?: unknown; duration?: unknown };
  const name = typeof d.drug === "string" ? d.drug.trim().slice(0, 120) : "";
  if (!name) return null;
  const item: PrescriptionItem = { name };
  if (typeof d.dosage === "string" && d.dosage.trim()) item.dose = d.dosage.trim().slice(0, 120);
  const duration = typeof d.duration === "string" ? d.duration.trim() : "";
  const m = /^(\d{1,3})\s*(day|week|month|year)s?$/i.exec(duration);
  if (m) {
    item.durationValue = Number(m[1]);
    item.durationUnit = `${m[2].toLowerCase()}s` as PrescriptionItem["durationUnit"];
  } else if (duration) {
    item.note = duration.slice(0, 200);
  }
  return item;
}
