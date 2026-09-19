import "server-only";

import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { appointments, visits } from "@/core/db/schema";
import { getDoctorBalances } from "@/core/sales/payouts";
import { getSharesReport } from "@/core/sales/share-report";
import type { ResolvedRange } from "@/core/sales/report";

/**
 * What ONE doctor did over a window, for the activity section on their staff record.
 *
 * DELIBERATELY NOT A SCORECARD. The super admin's clinic analytics rates a clinic
 * 0–5, and that is defensible because it measures one objective thing — how many days
 * after the due date each invoice settled. A date comparison carries no judgement.
 *
 * The same shape aimed at a PERSON would not. A no-show rate is mostly the front desk
 * and the patient mix; revenue follows whichever procedures the doctor is assigned;
 * cancellations are often the clinic's own doing. A composite score over those would
 * look as objective as the payment rating while measuring something else entirely —
 * and in a clinic, a number that pressures revenue-per-visit is a patient-safety
 * question before it is an HR one. So this returns FIGURES, each next to the
 * denominator it came from, and no grade, no stars and no band.
 *
 * Earnings come from the existing share ledger rather than a second sum of the same
 * money (ADR-015): `getDoctorBalances` is what `/clinic/shares` and the payout form
 * already agree on, so this page cannot quote a different number from them.
 */
export type DoctorActivity = {
  /** Appointments scheduled to this doctor inside the window, by outcome. */
  appointments: number;
  completed: number;
  cancelled: number;
  noShows: number;
  /** Over EXPECTED visits (completed + no-show), not over everything booked — a
   *  cancellation a week ahead is not a no-show and must not dilute the rate. */
  noShowRate: number | null;
  /** Visits recorded in the window, and how many were dictated. */
  visits: number;
  scribeRuns: number;
  /** Revenue share EARNED in the window (what this doctor's completed visits paid
   *  them), and the LIFETIME balance the shares page settles against. */
  earnedInWindow: number;
  earnedLifetime: number;
  paidLifetime: number;
  /** Everything between earned and outstanding that is NOT a payment: discounts this
   *  doctor bore, plus waives/repayments/write-offs. Signed. Exposed because the
   *  balance is `earned + adjustments − paid`, and a card that shows only three of
   *  those four terms invites a subtraction that does not come out. */
  adjustments: number;
  outstanding: number;
  /** False when the clinic has never given this doctor a share percentage — the
   *  money figures are then all zero for a reason, not for lack of work. */
  hasShareRate: boolean;
};

export async function getDoctorActivity(
  clinicId: string,
  doctorId: string,
  range: ResolvedRange,
): Promise<DoctorActivity> {
  const inWindow = and(
    gte(appointments.scheduledAt, range.start),
    lt(appointments.scheduledAt, range.end),
  );

  const [mix, visitRow, balances, shares] = await Promise.all([
    // One grouped scan for the whole appointment mix rather than four counts over
    // the same rows — the same shape the clinic scorecard uses.
    db
      .select({ status: appointments.status, n: count() })
      .from(appointments)
      .where(
        byClinic(
          appointments.clinicId,
          clinicId,
          and(eq(appointments.doctorId, doctorId), notDeleted(appointments.deletedAt), inWindow),
        ),
      )
      .groupBy(appointments.status),
    db
      .select({
        n: count(),
        scribe: sql<number>`count(*) filter (where ${visits.audioKey} is not null)`,
      })
      .from(visits)
      .where(
        byClinic(
          visits.clinicId,
          clinicId,
          and(
            eq(visits.doctorId, doctorId),
            notDeleted(visits.deletedAt),
            gte(visits.visitDate, range.start),
            lt(visits.visitDate, range.end),
          ),
        ),
      ),
    getDoctorBalances(clinicId, doctorId),
    getSharesReport(clinicId, range, doctorId),
  ]);

  const byStatus = new Map(mix.map((r) => [String(r.status), Number(r.n)]));
  const completed = byStatus.get("completed") ?? 0;
  const noShows = byStatus.get("no_show") ?? 0;
  const cancelled = byStatus.get("cancelled") ?? 0;
  const expected = completed + noShows;
  const balance = balances[0];

  return {
    appointments: [...byStatus.values()].reduce((a, b) => a + b, 0),
    completed,
    cancelled,
    noShows,
    noShowRate: expected > 0 ? noShows / expected : null,
    visits: Number(visitRow[0]?.n ?? 0),
    scribeRuns: Number(visitRow[0]?.scribe ?? 0),
    // Scoped to this doctor, so the report's own total IS their earnings — the same
    // figure `/clinic/shares` prints for them, not a second derivation of it.
    earnedInWindow: shares.shareTotal,
    earnedLifetime: balance?.earned ?? 0,
    paidLifetime: balance?.paid ?? 0,
    adjustments: (balance?.borne ?? 0) + (balance?.adjustments ?? 0),
    outstanding: balance?.outstanding ?? 0,
    hasShareRate: Boolean(balance),
  };
}
