"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/core/auth/user";
import { db } from "@/core/db";
import { visits } from "@/core/db/schema";

/**
 * Doctor actions on scribe drafts — CLAUDE.md §8: AI output is a DRAFT until the
 * doctor approves it. All queries are scoped to the doctor's own clinic_id.
 */

/** Approve a draft: save the (edited) note and mark it approved. */
export async function approveVisit(
  visitId: string,
  note: Record<string, unknown>,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };

  const result = await db
    .update(visits)
    .set({
      note,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: user.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.clinicId, user.clinicId),
        eq(visits.status, "draft"),
      ),
    )
    .returning({ id: visits.id });

  if (result.length === 0) return { error: "Draft not found." };
  revalidatePath("/doctor");
  return { ok: true };
}

/** Discard a draft the doctor doesn't want to keep. */
export async function discardDraft(
  visitId: string,
): Promise<{ ok: true } | { error: string }> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return { error: "No clinic." };

  const result = await db
    .delete(visits)
    .where(
      and(
        eq(visits.id, visitId),
        eq(visits.clinicId, user.clinicId),
        eq(visits.status, "draft"),
      ),
    )
    .returning({ id: visits.id });

  if (result.length === 0) return { error: "Draft not found." };
  revalidatePath("/doctor");
  return { ok: true };
}

/** Search this clinic's patients by name/phone for the scribe picker. */
export async function searchPatients(
  query: string,
): Promise<{ id: string; fullName: string; phone: string | null }[]> {
  const user = await requireRole("doctor");
  if (!user.clinicId) return [];
  const q = query.trim();

  const { patients } = await import("@/core/db/schema");
  const { ilike, or, and: and2, desc } = await import("drizzle-orm");

  return db
    .select({
      id: patients.id,
      fullName: patients.fullName,
      phone: patients.phone,
    })
    .from(patients)
    .where(
      q
        ? and2(
            eq(patients.clinicId, user.clinicId),
            or(
              ilike(patients.fullName, `%${q}%`),
              ilike(patients.phone, `%${q}%`),
            ),
          )
        : eq(patients.clinicId, user.clinicId),
    )
    .orderBy(desc(patients.createdAt))
    .limit(20);
}
