/**
 * Map a scribe DRAFT note into suggested odontogram edits — PURE. The doctor
 * reviews a pre-filled chart (still a draft) rather than raw JSON (plan §4). The
 * integration overlays this on the patient's CURRENT chart, so unchanged teeth carry
 * forward and this only supplies the visit's suggested changes. Best-effort keyword
 * mapping; the doctor confirms every tooth.
 */
import type { ChartTeeth, ToothStatus } from "@/modules/dental/db/schema";
import { isToothNumber } from "@/modules/dental/tooth-status";

/** Map an observed finding's free text to a status. */
function findingStatus(text: string): ToothStatus {
  const s = text.toLowerCase();
  if (/(caries|cavity|decay)/.test(s)) return "caries";
  if (/(fracture|broken|cracked|chipped)/.test(s)) return "fractured";
  if (/(missing|absent|edentulous)/.test(s)) return "missing";
  if (/(root canal|\brct\b|pulpitis|necrotic)/.test(s)) return "root_canal";
  if (/(extract)/.test(s)) return "to_extract";
  if (/(crown|cap)/.test(s)) return "crown";
  if (/(implant)/.test(s)) return "implant";
  return "watch";
}

/** Map a performed-treatment free text to the resulting status. */
function procedureStatus(text: string): ToothStatus | null {
  const s = text.toLowerCase();
  if (/(fill|restor|composite|amalgam|\bgic\b)/.test(s)) return "filled";
  if (/crown/.test(s)) return "crown";
  if (/(extract)/.test(s)) return "missing";
  if (/(root canal|\brct\b)/.test(s)) return "root_canal";
  if (/implant/.test(s)) return "implant";
  if (/sealant/.test(s)) return "sealant";
  if (/veneer/.test(s)) return "veneer";
  if (/bridge/.test(s)) return "bridge_abutment";
  return null;
}

/** Extract the first FDI-looking tooth number (quadrant 1-8, position 1-8) from text. */
function toothIn(text: string): string | null {
  const m = /\b([1-8][1-8])\b/.exec(text);
  return m && isToothNumber(m[1]) ? m[1] : null;
}

/** Suggested chart edits (FDI → state) derived from a scribe draft. */
export function seedFromNote(note: unknown): ChartTeeth {
  const n = (note && typeof note === "object" ? note : {}) as {
    findings?: { tooth?: string | null; finding?: string }[];
    treatmentPerformed?: string[];
  };
  const teeth: ChartTeeth = {};

  // Findings first (observations)…
  for (const f of Array.isArray(n.findings) ? n.findings : []) {
    const tooth = f?.tooth && isToothNumber(f.tooth) ? f.tooth : null;
    if (!tooth) continue;
    teeth[tooth] = { status: findingStatus(f.finding ?? "") };
  }
  // …then performed treatment overrides (what was actually done this visit).
  for (const p of Array.isArray(n.treatmentPerformed) ? n.treatmentPerformed : []) {
    const tooth = toothIn(p ?? "");
    if (!tooth) continue;
    const st = procedureStatus(p ?? "");
    if (st) teeth[tooth] = { status: st };
  }
  return teeth;
}
