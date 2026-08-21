import "server-only";

import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/core/db";
import { patients, users, visits } from "@/core/db/schema";
import { byClinic, notDeleted } from "@/core/db/tenant";

/**
 * Unapproved drafts belonging to one clinician — CORE.
 *
 * WHY THIS EXISTS: a draft is gated on its AUTHOR (ADR-007) — approve, discard and
 * even the list all require `doctor_id = <caller>`. That is the right rule while the
 * author can still log in. The moment they cannot, the draft becomes unreachable by
 * everyone: not approved so it fails the patient timeline's filter, not deleted so it
 * never reaches Trash, and not yours so it never reaches a draft list. It just sits
 * there — transcript, AI note and audio of a real consultation — visible to nobody.
 *
 * Deleting a staff member is the usual way that happens, and the admin doing it has
 * no idea: they think they removed an account, not that they buried three
 * consultations. So the delete flow asks this first and says the number out loud.
 *
 * Note the count deliberately does NOT filter on the author still being active — the
 * caller already knows which user it is about, and a suspended doctor's drafts are
 * only *temporarily* out of reach (reactivating restores them), which is a different
 * situation from deletion and shouldn't be conflated here.
 */
export async function countOpenDrafts(clinicId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(visits)
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        and(eq(visits.doctorId, userId), eq(visits.status, "draft")),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The author of this draft can no longer log in — so nobody can satisfy the ordinary
 * `doctor_id = <caller>` rule and the draft is stranded (delta D-18).
 *
 * Three ways that happens, and the FIRST is the common one:
 *   - the account was soft-deleted (`deleteStaff`) — the row survives, so
 *     `doctor_id` still points at it and is NOT null;
 *   - the account was suspended or deactivated (`is_active = false`);
 *   - the account was purged, the only physical delete — then `ON DELETE SET NULL`
 *     finally does fire and `doctor_id` is null.
 *
 * The delta was originally written around the third case alone, which would have
 * missed every ordinary staff deletion. The condition that actually matters is
 * "cannot authenticate", so it is expressed once, here.
 *
 * A correlated EXISTS rather than a join, so callers can drop it into a WHERE clause
 * without restructuring their query or risking a row multiplied by a join.
 */
export function authorIsStranded(): SQL {
  return sql`(
    ${visits.doctorId} is null
    or exists (
      select 1 from ${users} u
       where u.id = ${visits.doctorId}
         and (u.deleted_at is not null or u.is_active = false)
    )
  )`;
}

/**
 * Who may act on a draft: its author, always — plus, for a caller holding the
 * `handover` grant, one whose author is stranded.
 *
 * ONE definition for all three operations (open, approve, discard), because the
 * failure mode of getting this wrong is asymmetric: too strict merely blocks someone,
 * too loose lets a clinician sign a colleague's clinical judgement. D-16 was exactly
 * that bug — the rule lived in `loadDraft` but had been forgotten in the other two.
 *
 * Note `canHandover` is passed IN rather than resolved here: `can()` is pure and
 * belongs to the caller's auth context, and keeping this function a pure predicate
 * means the WHERE clause it builds is the same one the tests assert against.
 */
export function draftAccessCondition(userId: string, canHandover: boolean): SQL {
  const mine = eq(visits.doctorId, userId);
  if (!canHandover) return mine;
  // `or()` cannot return undefined for two defined operands, but its type says it can.
  return or(mine, authorIsStranded()) as SQL;
}

/** One stranded draft, labelled with who dictated it so the UI never implies otherwise. */
export type StrandedDraft = {
  id: string;
  visitDate: Date | null;
  patientName: string;
  authorName: string | null;
};

/**
 * Drafts nobody can reach any more — for a caller holding `handover:view`.
 *
 * Listed separately from a clinician's own drafts rather than merged into them: these
 * are somebody else's unfinished clinical thinking, and presenting them in the same
 * list as your own is how a note ends up approved by someone who never read who wrote
 * it. Oldest first — the one stranded longest is the one a patient has been waiting on.
 */
export async function listStrandedDrafts(clinicId: string): Promise<StrandedDraft[]> {
  return db
    .select({
      id: visits.id,
      visitDate: visits.visitDate,
      patientName: patients.fullName,
      authorName: users.fullName,
    })
    .from(visits)
    .innerJoin(patients, eq(visits.patientId, patients.id))
    .leftJoin(users, eq(visits.doctorId, users.id))
    .where(
      byClinic(
        visits.clinicId,
        clinicId,
        notDeleted(visits.deletedAt),
        and(eq(visits.status, "draft"), authorIsStranded()),
      ),
    )
    .orderBy(visits.visitDate)
    .limit(50);
}
