import "server-only";
import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { cities, clinics } from "@/core/db/schema";
import { notDeleted } from "@/core/db/tenant";
import { asProvinceCode, type ProvinceCode } from "@/core/clinics/provinces";

export type CityOption = { id: number; name: string; province: ProvinceCode };

/**
 * Every city the clinic form may offer, ordered for a dropdown.
 *
 * Company-global reference data, so no `byClinic()` — the table has no `clinic_id` and
 * the tenant guard ignores it.
 */
export async function listCities(): Promise<CityOption[]> {
  const rows = await db
    .select({ id: cities.id, name: cities.name, province: cities.province })
    .from(cities)
    .where(eq(cities.isActive, true))
    .orderBy(asc(cities.province), asc(cities.name));

  // A row whose province predates a change to PROVINCES would be unusable in the form;
  // drop it rather than render a city filed under a heading that no longer exists.
  return rows.flatMap((r) => {
    const province = asProvinceCode(r.province);
    return province ? [{ id: r.id, name: r.name, province }] : [];
  });
}

/**
 * The id for a city, creating the row if this is the first clinic in that town.
 *
 * FIND OR CREATE is what keeps onboarding unblocked without giving up the counts. The
 * seed covers towns above roughly 50k people; Pakistan has a great many clinics below
 * that line, and a dropdown that cannot express where they are would push whoever is
 * onboarding them into picking the nearest big city — which is worse than free text,
 * because it produces a confident wrong number instead of an obviously missing one.
 *
 * Matching is case- and whitespace-insensitive so "lahore" and "Lahore " reuse the
 * existing row. The stored name keeps the caller's capitalisation only when the row is
 * genuinely new.
 *
 * `ON CONFLICT DO NOTHING` + a re-read rather than a check-then-insert: two admins
 * onboarding clinics in the same new town at the same moment would otherwise create two
 * rows and split that town's count, which is the one thing this table exists to prevent.
 */
export async function findOrCreateCity(
  name: string,
  province: ProvinceCode,
): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const existing = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(sql`lower(${cities.name}) = lower(${trimmed})`, eq(cities.province, province)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(cities)
    .values({ name: trimmed, province })
    .onConflictDoNothing({ target: [cities.name, cities.province] })
    .returning({ id: cities.id });
  if (inserted[0]) return inserted[0].id;

  // Lost the race — the other writer's row is the right one.
  const race = await db
    .select({ id: cities.id })
    .from(cities)
    .where(and(sql`lower(${cities.name}) = lower(${trimmed})`, eq(cities.province, province)))
    .limit(1);
  return race[0]?.id ?? null;
}

export type CityCount = { cityId: number; city: string; province: ProvinceCode; clinics: number };

/**
 * How many live clinics sit in each city — the question free text could not answer.
 *
 * Aggregated in SQL at the grain it is displayed (ADR-025): one row per city, bounded by
 * how many cities have clinics, not by how many clinics there are.
 */
export async function getClinicCountsByCity(limit = 10): Promise<CityCount[]> {
  const rows = await db
    .select({
      cityId: cities.id,
      city: cities.name,
      province: cities.province,
      clinics: count(clinics.id),
    })
    .from(clinics)
    .innerJoin(cities, eq(cities.id, clinics.cityId))
    .where(and(notDeleted(clinics.deletedAt), isNotNull(clinics.cityId)))
    .groupBy(cities.id, cities.name, cities.province)
    .orderBy(desc(count(clinics.id)), asc(cities.name))
    .limit(limit);

  return rows.flatMap((r) => {
    const province = asProvinceCode(r.province);
    return province ? [{ ...r, province }] : [];
  });
}

export type ProvinceCount = { province: ProvinceCode; clinics: number };

/** Live clinics per province, including provinces with none so the total reads honestly. */
export async function getClinicCountsByProvince(): Promise<ProvinceCount[]> {
  const rows = await db
    .select({ province: clinics.province, clinics: count(clinics.id) })
    .from(clinics)
    .where(and(notDeleted(clinics.deletedAt), isNotNull(clinics.province)))
    .groupBy(clinics.province)
    .orderBy(desc(count(clinics.id)));

  return rows.flatMap((r) => {
    const province = asProvinceCode(r.province);
    return province ? [{ province, clinics: r.clinics }] : [];
  });
}

/** Clinics with no city recorded — the gap that makes every count above an understatement. */
export async function countClinicsWithoutCity(): Promise<number> {
  const [row] = await db
    .select({ n: count(clinics.id) })
    .from(clinics)
    .where(and(notDeleted(clinics.deletedAt), sql`${clinics.cityId} is null`));
  return row?.n ?? 0;
}

/** The name behind a stored `clinics.city_id`, active or not. */
export async function getCityName(id: number | null): Promise<string | null> {
  if (id === null) return null;
  const [row] = await db.select({ name: cities.name }).from(cities).where(eq(cities.id, id)).limit(1);
  return row?.name ?? null;
}
