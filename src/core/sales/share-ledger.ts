import "server-only";

import { eq, inArray } from "drizzle-orm";
import { byClinic } from "@/core/db/tenant";
import type { Executor } from "@/core/db/tx";
import { saleShares, users } from "@/core/db/schema";
import { computeShare } from "@/core/appointments/shares";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import type { MoneyDay } from "@/core/sales/money-days";

/**
 * Per-doctor EARNINGS ledger — each doctor's share of a PAID appointment on a
 * **collected, GROSS** basis (discount-bearing phase 3): a doctor earns his full
 * pre-discount cut scaled by `collected ÷ gross`. The discount itself is NOT taken
 * out here — it's handled entirely by the settlement ledger (`discount_settlements`),
 * so a doctor's true net = these earnings + his settlement. The clinic's cut is
 * derived (sale net − Σ doctor net). Only doctor rows are stored; recording REPLACES
 * all rows for the appointment. Inert by default (no share % → no rows).
 *
 * TAKES AN EXECUTOR AND THROWS ON FAILURE — deliberately (ADR-016). This is one step
 * of the derived-write transaction opened by `recordSaleForAppointment`. Catching here
 * would leave that transaction aborted while pretending to succeed, and the *next*
 * statement would fail for an unrelated-looking reason. There is exactly one
 * best-effort boundary, and it is the outer one: it reports, rolls back the whole
 * derived set, and leaves the reconciliation job to repair it.
 *
 * The executor is used for READS too, not just writes — see `core/db/tx.ts`.
 */
export async function recordSaleSharesForAppointment(
  clinicId: string,
  appointmentId: string,
  exec: Executor,
  /** The visit's money days (`money-days.ts`) — the sale's own, so the two agree. */
  days: MoneyDay[],
): Promise<void> {
  const ctx = await getAppointmentShareContext(clinicId, appointmentId, exec);

  // Always clear first so a re-snapshot (e.g. an edit that zeroed a share) can't
  // leave stale rows behind.
  await exec
    .delete(saleShares)
    .where(byClinic(saleShares.clinicId, clinicId, eq(saleShares.appointmentId, appointmentId)));

  if (!ctx.found || !ctx.occurredAt) return;

  if (days.length === 0 || ctx.grossTotal <= 0) return;

  // Each doctor earns his GROSS cut scaled by collected ÷ gross (the discount is
  // borne separately in the settlement ledger) — earned on the DAY the money arrives,
  // like the sale (owner's call, 2026-10-13). Per doctor, rounding is done on the
  // RUNNING total and each day's row is the difference, so the rows sum to exactly
  // the share the old single snapshot held; a refund day is a negative row.
  const gross = computeShare({
    consultation: ctx.consultation,
    lines: ctx.lines,
    netTotal: ctx.grossTotal, // no discount → each doctor's full gross cut
    borneBy: "clinic",
  });
  const doctorCuts = Object.entries(gross.doctors).filter(([, amt]) => amt > 0);
  if (doctorCuts.length === 0) return;

  const earning: { doctorId: string; shareAmount: number; at: Date }[] = [];
  const prev = new Map<string, number>();
  for (const d of days) {
    const fraction = d.cumulative / ctx.grossTotal;
    for (const [doctorId, amt] of doctorCuts) {
      const cum = Math.round(amt * fraction);
      const delta = cum - (prev.get(doctorId) ?? 0);
      prev.set(doctorId, cum);
      if (delta !== 0) earning.push({ doctorId, shareAmount: delta, at: d.at });
    }
  }
  if (earning.length === 0) return;

  // Name snapshots for the earning doctors (clinic-scoped).
  const ids = [...new Set(earning.map((e) => e.doctorId))];
  const names = new Map<string, string>();
  const rows = await exec
    .select({ id: users.id, fullName: users.fullName, username: users.username })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, inArray(users.id, ids)));
  for (const r of rows) names.set(r.id, r.fullName ?? r.username);

  await exec.insert(saleShares).values(
    earning.map((e) => ({
      clinicId,
      appointmentId,
      doctorId: e.doctorId,
      doctorName: names.get(e.doctorId) ?? null,
      shareAmount: e.shareAmount,
      occurredAt: e.at,
    })),
  );
}

/**
 * Removes an appointment's per-doctor share rows (the visit was trashed).
 * Throws on failure — same reasoning as above; the outer boundary reports.
 */
export async function voidSaleSharesForAppointment(
  clinicId: string,
  appointmentId: string,
  exec: Executor,
): Promise<void> {
  await exec
    .delete(saleShares)
    .where(byClinic(saleShares.clinicId, clinicId, eq(saleShares.appointmentId, appointmentId)));
}
