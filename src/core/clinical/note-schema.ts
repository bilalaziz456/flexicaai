import { z } from "zod";

/**
 * Clinical-note validation — CORE, specialty-agnostic and PURE (no DB, no
 * `server-only`), so the same rules apply on the AI path and the doctor-edit path.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * `visits.note` and the module chart are `jsonb` written from CLIENT input: the
 * doctor edits the AI draft in the browser and posts the whole object back. Until
 * now that arrived as `Record<string, unknown>` and went straight into the medical
 * record — no shape check, no size limit. Two problems, and the second is the one
 * that bites first:
 *   1. Downstream readers (the prescription PDF, the patient timeline, the recall
 *      capture, the tooth-chart seeder) all assume a shape and defensively re-check
 *      it in their own way. Garbage in one field silently drops a prescription.
 *   2. Nothing bounded the SIZE. A client could post megabytes of nested JSON into a
 *      row that is then read on every patient-detail render.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY IT IS PERMISSIVE, DELIBERATELY
 * ─────────────────────────────────────────────────────────────────────────
 * A strict schema would be wrong here and would reject real records. There is more
 * than one legitimate note shape already:
 *   • the dental scribe shape (`chiefComplaint`, `findings`, `prescriptions`, …)
 *   • imported historical visits: `{ imported: true, summary, doctorName? }`
 * and a future module will invent a third. The model may also add a field the prompt
 * didn't ask for, which is worth keeping rather than silently discarding.
 *
 * So the contract is: **bounded always, structurally checked where we READ it,
 * pass-through in between.** Unknown keys survive. Known keys must be the right type
 * or the note is rejected — because a `prescriptions` that isn't an array is a
 * prescription that vanishes, and that must fail loudly at the boundary rather than
 * quietly at render.
 */

/** Hard ceiling on a serialized note. Generous for prose, fatal to abuse. */
export const MAX_NOTE_BYTES = 128 * 1024;
/** Hard ceiling on a serialized module chart (a tooth chart is ~32 small entries). */
export const MAX_CHART_BYTES = 256 * 1024;

const MAX_DEPTH = 8;
const MAX_KEYS = 200;
const MAX_ARRAY = 500;
const MAX_STRING = 20_000;

export type NoteParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Structural bounds, applied before any shape check. Rejects the pathological rather
 * than the merely unexpected: too deep, too wide, too long, or not a plain object.
 * Functions/symbols/undefined cannot survive the JSON round-trip anyway.
 */
function checkBounds(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return "The note is nested too deeply.";
  if (value === null) return null;
  const t = typeof value;
  if (t === "string") {
    return (value as string).length > MAX_STRING ? "A field in the note is too long." : null;
  }
  if (t === "number") {
    return Number.isFinite(value) ? null : "The note contains an invalid number.";
  }
  if (t === "boolean") return null;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return "A list in the note has too many entries.";
    for (const v of value) {
      const e = checkBounds(v, depth + 1);
      if (e) return e;
    }
    return null;
  }
  if (t === "object") {
    const keys = Object.keys(value as object);
    if (keys.length > MAX_KEYS) return "The note has too many fields.";
    for (const k of keys) {
      if (k.length > 200) return "The note has an invalid field name.";
      const e = checkBounds((value as Record<string, unknown>)[k], depth + 1);
      if (e) return e;
    }
    return null;
  }
  return "The note contains a value that can't be stored.";
}

/** A plain JSON object, within bounds. The floor every clinical payload must clear. */
export const boundedClinicalObject = z
  .record(z.string(), z.unknown())
  .refine((v) => !Array.isArray(v), { message: "The note must be an object." })
  .superRefine((v, ctx) => {
    const bound = checkBounds(v);
    if (bound) ctx.addIssue({ code: "custom", message: bound });
  });

/** Byte-size check — done on the serialized form, which is what Postgres stores. */
function withinBytes(value: unknown, max: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") <= max;
  } catch {
    // Circular or otherwise unserializable — it could never reach jsonb anyway.
    return false;
  }
}

/**
 * Validates a clinical note. `moduleSchema` is the enabled specialty's shape (see
 * `ModuleDefinition.noteSchema`); when a clinic has no module schema the note still
 * gets the generic bounds, so nothing is ever stored unchecked.
 */
export function parseClinicalNote(
  value: unknown,
  moduleSchema?: z.ZodType<Record<string, unknown>>,
): NoteParseResult<Record<string, unknown>> {
  const base = boundedClinicalObject.safeParse(value);
  if (!base.success) {
    return { ok: false, error: base.error.issues[0]?.message ?? "The note is not valid." };
  }
  if (!withinBytes(base.data, MAX_NOTE_BYTES)) {
    return { ok: false, error: "The note is too large to save." };
  }
  if (!moduleSchema) return { ok: true, value: base.data };

  const shaped = moduleSchema.safeParse(base.data);
  if (!shaped.success) {
    return { ok: false, error: shaped.error.issues[0]?.message ?? "The note is not valid." };
  }
  return { ok: true, value: shaped.data };
}

/**
 * Validates a module chart (the tooth chart, for dental). Core never inspects its
 * shape — that is the module's business — but it always applies the bounds, because
 * "core doesn't know what this is" must not mean "anything goes".
 */
export function parseClinicalChart(
  value: unknown,
  moduleSchema?: z.ZodType,
): NoteParseResult<unknown> {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const base = boundedClinicalObject.safeParse(value);
  if (!base.success) {
    return { ok: false, error: base.error.issues[0]?.message ?? "The chart is not valid." };
  }
  if (!withinBytes(base.data, MAX_CHART_BYTES)) {
    return { ok: false, error: "The chart is too large to save." };
  }
  if (!moduleSchema) return { ok: true, value: base.data };

  const shaped = moduleSchema.safeParse(base.data);
  if (!shaped.success) {
    return { ok: false, error: shaped.error.issues[0]?.message ?? "The chart is not valid." };
  }
  return { ok: true, value: shaped.data };
}
