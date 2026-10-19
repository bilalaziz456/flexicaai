import "server-only";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { clinicMedicines, clinics, medicines } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { unscoped } from "@/core/db/tenant-guard";
import type { Drug } from "@/core/types/module";

/**
 * Medicines (owner's call, 2026-10-19): the company's MASTER list, which every
 * clinic's prescription and medical-history medicine lines suggest from, plus each
 * clinic's OWN additions, which only that clinic sees. Picking a suggestion fills the
 * medicine name and nothing else, so neither list carries a dose.
 *
 * Specialty-agnostic: a master medicine's `specialties` are module ids as plain
 * text, compared against the clinic's `modules_enabled` the caller passes in. Core
 * never names one.
 */

export type MedicineInput = {
  name: string;
  brands: string[];
  form: string | null;
  strength: string | null;
};

export type Actor = { id: string; name: string };

/** "Augmentin, Calamox" → ["Augmentin", "Calamox"]: trimmed, de-duplicated, bounded. */
export function parseBrandList(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[,\n]/)
    .map((b) => b.trim().slice(0, 60))
    .filter((b) => b && !seen.has(b.toLowerCase()) && seen.add(b.toLowerCase()))
    .slice(0, 20);
}

const nameIs = (column: typeof medicines.name | typeof clinicMedicines.name, name: string) =>
  sql`lower(${column}) = lower(${name.trim()})`;

/** Postgres unique violation: two saves racing past the check below. */
const isDuplicate = (e: unknown) => (e as { code?: string })?.code === "23505";

// ---- The master list (company-wide, no clinic_id) ------------------------------

export type PageOpts = { q?: string; limit: number; offset: number };

/** One page of the master list, and how many match in all (ADR-024: the total is
 *  counted over the whole filtered set, never folded from the page). */
export async function listMasterMedicines(opts: PageOpts & { retired?: boolean }) {
  const q = opts.q?.trim();
  const conds: SQL[] = [eq(medicines.isActive, !opts.retired)];
  if (q) {
    conds.push(
      or(
        ilike(medicines.name, `%${q}%`),
        sql`exists (select 1 from unnest(${medicines.brands}) b where b ilike ${`%${q}%`})`,
      )!,
    );
  }
  const where = and(...conds);
  const [rows, [count]] = await Promise.all([
    db.select().from(medicines).where(where).orderBy(asc(medicines.name)).limit(opts.limit).offset(opts.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(medicines).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

export async function countMasterMedicines(): Promise<{ active: number; retired: number }> {
  const [r] = await db
    .select({
      active: sql<number>`count(*) filter (where ${medicines.isActive})::int`,
      retired: sql<number>`count(*) filter (where not ${medicines.isActive})::int`,
    })
    .from(medicines);
  return { active: r?.active ?? 0, retired: r?.retired ?? 0 };
}

export async function createMasterMedicine(
  input: MedicineInput & { specialties: string[] },
  actor: Actor,
): Promise<{ id: string } | { error: string }> {
  const [clash] = await db.select({ id: medicines.id }).from(medicines).where(nameIs(medicines.name, input.name));
  if (clash) return { error: `${input.name} is already in the list (it may be retired).` };
  try {
    const [row] = await db
      .insert(medicines)
      .values({ ...input, name: input.name.trim(), createdBy: actor.id, createdByName: actor.name })
      .returning({ id: medicines.id });
    return { id: row.id };
  } catch (e) {
    if (isDuplicate(e)) return { error: `${input.name} is already in the list.` };
    throw e;
  }
}

export async function updateMasterMedicine(
  id: string,
  input: MedicineInput & { specialties: string[] },
): Promise<{ ok: true } | { error: string }> {
  const [clash] = await db
    .select({ id: medicines.id })
    .from(medicines)
    .where(and(nameIs(medicines.name, input.name), sql`${medicines.id} <> ${id}`));
  if (clash) return { error: `Another medicine is already called ${input.name}.` };
  try {
    const rows = await db
      .update(medicines)
      .set({ ...input, name: input.name.trim(), updatedAt: new Date() })
      .where(eq(medicines.id, id))
      .returning({ id: medicines.id });
    return rows.length ? { ok: true } : { error: "Medicine not found." };
  } catch (e) {
    if (isDuplicate(e)) return { error: `Another medicine is already called ${input.name}.` };
    throw e;
  }
}

/** Retire (false) or bring back (true). Never a delete: prescriptions name it. */
export async function setMasterMedicineActive(id: string, active: boolean): Promise<boolean> {
  const rows = await db
    .update(medicines)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(medicines.id, id))
    .returning({ id: medicines.id });
  return rows.length > 0;
}

// ---- A clinic's own medicines ---------------------------------------------------

function clinicMedicinesWhere(clinicId: string, q?: string) {
  const term = q?.trim();
  return byClinic(
    clinicMedicines.clinicId,
    clinicId,
    notDeleted(clinicMedicines.deletedAt),
    term
      ? or(
          ilike(clinicMedicines.name, `%${term}%`),
          sql`exists (select 1 from unnest(${clinicMedicines.brands}) b where b ilike ${`%${term}%`})`,
        )
      : undefined,
  );
}

/** Every one of the clinic's own medicines — what its forms suggest. */
export async function listClinicMedicines(clinicId: string) {
  return db.select().from(clinicMedicines).where(clinicMedicinesWhere(clinicId)).orderBy(asc(clinicMedicines.name));
}

/** One page of the clinic's own medicines, and how many match in all. */
export async function listClinicMedicinesPage(clinicId: string, opts: PageOpts) {
  const where = clinicMedicinesWhere(clinicId, opts.q);
  const [rows, [count]] = await Promise.all([
    db.select().from(clinicMedicines).where(where).orderBy(asc(clinicMedicines.name)).limit(opts.limit).offset(opts.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(clinicMedicines).where(where),
  ]);
  return { rows, total: count?.n ?? 0 };
}

/** Refused when the master list already has it (it is suggested already) or the clinic does. */
async function clinicNameClash(clinicId: string, name: string, exceptId?: string): Promise<string | null> {
  const [master] = await db
    .select({ id: medicines.id })
    .from(medicines)
    .where(and(nameIs(medicines.name, name), eq(medicines.isActive, true)));
  if (master) return `${name} is already in the medicine list, so it is suggested already.`;
  const [own] = await db
    .select({ id: clinicMedicines.id })
    .from(clinicMedicines)
    .where(
      byClinic(
        clinicMedicines.clinicId,
        clinicId,
        notDeleted(clinicMedicines.deletedAt),
        nameIs(clinicMedicines.name, name),
        exceptId ? sql`${clinicMedicines.id} <> ${exceptId}` : undefined,
      ),
    );
  return own ? `Your clinic already has ${name}.` : null;
}

export async function createClinicMedicine(
  clinicId: string,
  input: MedicineInput,
  actor: Actor,
): Promise<{ id: string } | { error: string }> {
  const clash = await clinicNameClash(clinicId, input.name);
  if (clash) return { error: clash };
  try {
    const [row] = await db
      .insert(clinicMedicines)
      .values({ ...input, name: input.name.trim(), clinicId, createdBy: actor.id, createdByName: actor.name })
      .returning({ id: clinicMedicines.id });
    return { id: row.id };
  } catch (e) {
    if (isDuplicate(e)) return { error: `Your clinic already has ${input.name}.` };
    throw e;
  }
}

export async function updateClinicMedicine(
  clinicId: string,
  id: string,
  input: MedicineInput,
): Promise<{ ok: true } | { error: string }> {
  const clash = await clinicNameClash(clinicId, input.name, id);
  if (clash) return { error: clash };
  try {
    const rows = await db
      .update(clinicMedicines)
      .set({ ...input, name: input.name.trim(), updatedAt: new Date() })
      .where(byClinic(clinicMedicines.clinicId, clinicId, eq(clinicMedicines.id, id), notDeleted(clinicMedicines.deletedAt)))
      .returning({ id: clinicMedicines.id });
    return rows.length ? { ok: true } : { error: "Medicine not found." };
  } catch (e) {
    if (isDuplicate(e)) return { error: `Your clinic already has ${input.name}.` };
    throw e;
  }
}

/** Soft delete (nothing is hard-deleted); a prescription that names it is unchanged. */
export async function deleteClinicMedicine(clinicId: string, id: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(clinicMedicines)
    .set({ deletedAt: new Date(), deletedBy: userId })
    .where(byClinic(clinicMedicines.clinicId, clinicId, eq(clinicMedicines.id, id), notDeleted(clinicMedicines.deletedAt)))
    .returning({ id: clinicMedicines.id });
  return rows.length > 0;
}

// ---- What clinics added, for the super admin ------------------------------------

/** Every clinic's own medicines, newest first, flagged when the master list has the name since. */
export function listMedicinesAddedByClinics(opts: PageOpts) {
  const term = opts.q?.trim();
  const where = and(
    notDeleted(clinicMedicines.deletedAt),
    term ? or(ilike(clinicMedicines.name, `%${term}%`), ilike(clinics.name, `%${term}%`)) : undefined,
  );
  return unscoped("super admin reviews medicines clinics added", async () => {
    const [rows, [count]] = await Promise.all([
      db
      .select({
        id: clinicMedicines.id,
        name: clinicMedicines.name,
        brands: clinicMedicines.brands,
        form: clinicMedicines.form,
        strength: clinicMedicines.strength,
        clinicName: clinics.name,
        createdByName: clinicMedicines.createdByName,
        createdAt: clinicMedicines.createdAt,
        inMaster: sql<boolean>`exists (select 1 from ${medicines} m where lower(m.name) = lower(${clinicMedicines.name}))`,
      })
      .from(clinicMedicines)
      .innerJoin(clinics, eq(clinics.id, clinicMedicines.clinicId))
      .where(where)
      .orderBy(sql`${clinicMedicines.createdAt} desc`)
      .limit(opts.limit)
      .offset(opts.offset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(clinicMedicines)
        .innerJoin(clinics, eq(clinics.id, clinicMedicines.clinicId))
        .where(where),
    ]);
    return { rows, total: count?.n ?? 0 };
  });
}

/** Copy a clinic's medicine into the master list (the clinic's own row is left as is). */
export async function copyClinicMedicineToMaster(
  clinicMedicineId: string,
  actor: Actor,
): Promise<{ id: string } | { error: string }> {
  const [src] = await unscoped("super admin copies a clinic medicine to the master list", () =>
    db
      .select()
      .from(clinicMedicines)
      .where(and(eq(clinicMedicines.id, clinicMedicineId), notDeleted(clinicMedicines.deletedAt))),
  );
  if (!src) return { error: "Medicine not found." };
  return createMasterMedicine(
    { name: src.name, brands: src.brands, form: src.form, strength: src.strength, specialties: [] },
    actor,
  );
}

// ---- What the forms suggest -----------------------------------------------------

export type MedicineSuggestion = { value: string; label: string };

const describe = (form: string | null, strength: string | null) =>
  [form, strength].filter(Boolean).join(" ");

/**
 * The medicine names a clinic's forms suggest, in the order they should appear: the
 * clinic's own first, then master medicines usual for the clinic's specialties, then
 * the rest. Each generic name AND each brand is its own suggestion, because the desk
 * types whichever the doctor wrote; the label says what the other half is.
 */
export async function medicineSuggestions(
  clinicId: string,
  modulesEnabled: readonly string[],
): Promise<MedicineSuggestion[]> {
  const [own, master] = await Promise.all([
    listClinicMedicines(clinicId),
    db.select().from(medicines).where(eq(medicines.isActive, true)).orderBy(asc(medicines.name)),
  ]);
  const enabled = new Set(modulesEnabled);
  const usual = master.filter((m) => m.specialties.some((s) => enabled.has(s)));
  const rest = master.filter((m) => !m.specialties.some((s) => enabled.has(s)));

  const out: MedicineSuggestion[] = [];
  const seen = new Set<string>();
  const push = (value: string, label: string) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value, label });
  };
  for (const m of [...own, ...usual, ...rest]) {
    const what = describe(m.form, m.strength);
    push(m.name, [what, m.brands.join(", ")].filter(Boolean).join(" · "));
    for (const b of m.brands) push(b, [m.name, what].filter(Boolean).join(" · "));
  }
  return out;
}

/** Master + the clinic's own, as the scribe's drug check reads them (names + brands). */
export async function medicineFormulary(clinicId: string): Promise<Drug[]> {
  const [own, master] = await Promise.all([
    listClinicMedicines(clinicId),
    db.select().from(medicines).where(eq(medicines.isActive, true)),
  ]);
  return [...own, ...master].map((m) => ({ name: m.name, brands: m.brands, form: m.form ?? "" }));
}
