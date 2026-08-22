import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { users } from "@/core/db/schema";
import { displayStaffName } from "@/core/types/auth";
import type { DayAvailability } from "@/core/lib/availability";

export type ClinicDoctor = {
  id: string;
  /** "Dr. Bilal Aziz" — prefix applied, username as the last resort. */
  name: string;
  /** The raw parts too, for callers that format differently (a <select>, a form). */
  fullName: string | null;
  username: string;
  availability: DayAvailability[];
  /** True = bookable any time; working hours are not enforced, so a calendar
   *  must NOT print a window for them (there isn't one to honour). */
  flexibleHours: boolean;
  /** Suspended/deactivated doctors are never shown as available. */
  isActive: boolean;
  /** PKR; 0 = not set. The booking form pre-fills the bill from it. */
  consultationFee: number;
  /** 0 = unlimited. The schedule editor and the slot check both read it. */
  dailyLimit: number;
};

export type DoctorListOptions = {
  /** Scope to ONE doctor — a doctor viewing their own schedule sees only themselves. */
  doctorId?: string;
  /**
   * `name` (default) is alphabetical, which is what a picker wants. `newest` preserves
   * the doctors panel's original created-desc order — a display order is still
   * behaviour, and this refactor is not the place to change one.
   */
  order?: "name" | "newest";
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
  opts: DoctorListOptions = {},
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
      consultationFee: users.consultationFee,
      dailyLimit: users.dailyAppointmentLimit,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      byClinic(
        users.clinicId,
        clinicId,
        notDeleted(users.deletedAt),
        // A doctor-scoped view asks for one id; everyone else gets the clinic's doctors.
        opts.doctorId ? eq(users.id, opts.doctorId) : eq(users.role, "doctor"),
      ),
    )
    .orderBy(opts.order === "newest" ? desc(users.createdAt) : asc(users.fullName));

  return rows.map((r) => ({
    id: r.id,
    name: displayStaffName(r.prefix, r.fullName, r.username),
    fullName: r.fullName,
    username: r.username,
    availability: (r.availability ?? []) as DayAvailability[],
    flexibleHours: r.flexibleHours,
    isActive: r.isActive,
    consultationFee: r.consultationFee,
    dailyLimit: r.dailyLimit,
  }));
}
