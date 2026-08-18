import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";
import type { DayAvailability } from "@/core/lib/availability";

export type ClinicDoctor = {
  id: string;
  /** "Dr. Bilal Aziz" — prefix applied, username as the last resort. */
  name: string;
  availability: DayAvailability[];
  /** True = bookable any time; working hours are not enforced, so a calendar
   *  must NOT print a window for them (there isn't one to honour). */
  flexibleHours: boolean;
  /** Suspended/deactivated doctors are never shown as available. */
  isActive: boolean;
};

/**
 * A clinic's doctors WITH their schedule — the source for deriving who is on
 * duty on a given date. One query; the caller keeps the result for the whole
 * render rather than re-querying per day.
 *
 * Distinct from `getSalesDoctors` (core/sales/report.ts), which omits the name
 * prefix and the schedule and belongs to the sales report.
 */
export async function listClinicDoctors(
  clinicId: string,
): Promise<ClinicDoctor[]> {
  const rows = await db
    .select({
      id: users.id,
      prefix: users.prefix,
      fullName: users.fullName,
      username: users.username,
      availability: users.availability,
      flexibleHours: users.flexibleHours,
      isActive: users.isActive,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        eq(users.role, "doctor"),
      ),
    )
    .orderBy(asc(users.fullName));

  return rows.map((r) => ({
    id: r.id,
    name: displayStaffName(r.prefix, r.fullName, r.username),
    availability: (r.availability ?? []) as DayAvailability[],
    flexibleHours: r.flexibleHours,
    isActive: r.isActive,
  }));
}
