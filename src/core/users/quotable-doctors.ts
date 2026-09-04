import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";
import { describeConsultationHours, type DayAvailability } from "@/core/lib/availability";

export type QuotableDoctor = {
  id: string;
  name: string;
  /** PKR. 0 means NOT SET — never "free". See the note below. */
  fee: number;
  /** Consultation hours a patient can read, or "" when none are set. */
  hours: string;
  /**
   * Bookable at any time (`users.flexible_hours`). Distinct from having no hours
   * SET: one means "any time suits", the other means we do not know. A timings reply
   * must not silently turn the second into the first.
   */
  flexible: boolean;
};

/**
 * The clinic's active doctors, with their consultation fee — CORE, clinic-scoped.
 *
 * Handed to the classifier as a CLOSED SET, exactly like the procedure list: the
 * model may only return an id from here, and the fee is read from the row afterwards,
 * so no figure ever passes through it.
 *
 * DOCTORS WITH NO FEE ARE STILL RETURNED, and that is deliberate. `consultation_fee`
 * defaults to 0, which means "not set" — never "free". Dropping those doctors here
 * would make them unmatchable, so a patient asking about two doctors would get one
 * answered and the other silently ignored, which reads as though the question was
 * only half heard. They are included, marked by `fee === 0`, and the reply says
 * plainly that the clinic can confirm that one.
 */
export async function listQuotableDoctors(clinicId: string): Promise<QuotableDoctor[]> {
  const rows = await db
    .select({
      id: users.id,
      prefix: users.prefix,
      fullName: users.fullName,
      username: users.username,
      fee: users.consultationFee,
      availability: users.availability,
      flexibleHours: users.flexibleHours,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        and(eq(users.role, "doctor"), eq(users.isActive, true)),
      ),
    )
    .orderBy(asc(users.fullName));

  return rows.map((r) => ({
    id: r.id,
    name: displayStaffName(r.prefix, r.fullName, r.username),
    fee: r.fee,
    // A flexible-hours doctor is bookable any time by design, so listing windows for
    // them would be wrong even if some exist. Everyone else gets their CONSULTATION
    // windows only — a procedure window is not when you get seen for a consultation.
    hours: r.flexibleHours
      ? ""
      : describeConsultationHours((r.availability ?? []) as DayAvailability[]),
    flexible: r.flexibleHours,
  }));
}
