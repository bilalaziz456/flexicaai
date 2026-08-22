import "server-only";

import { asc, count, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { patients, recalls } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";

/**
 * The clinic's recall list — CORE per ADR-014.
 *
 * Ordered by DUE DATE ascending, not by when it was created: the whole point of the
 * page is "who should we be calling next", and the most overdue recall is the one the
 * clinic is losing money on.
 */
export async function listClinicRecalls(
  clinicId: string,
  paging: { offset: number; limit: number },
) {
  const where = byClinic(recalls.clinicId, clinicId, notDeleted(recalls.deletedAt));
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: recalls.id,
        reason: recalls.reason,
        dueAt: recalls.dueAt,
        status: recalls.status,
        patientName: patients.fullName,
        patientPhone: patients.phone,
      })
      .from(recalls)
      .innerJoin(patients, eq(recalls.patientId, patients.id))
      .where(where)
      .orderBy(asc(recalls.dueAt))
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(recalls).where(where),
  ]);
  return { rows, total: totalRow?.total ?? 0 };
}
