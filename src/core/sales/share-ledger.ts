import "server-only";

import { eq, inArray } from "drizzle-orm";
import { byClinic } from "@/core/db/tenant";
import type { Executor } from "@/core/db/tx";
import { appointments, saleShares, users } from "@/core/db/schema";
import { computeShare } from "@/core/appointments/shares";
import { getAppointmentShareContext } from "@/core/appointments/share-context";

/**
 * Per-doctor EARNINGS ledger — each doctor's share of a COMPLETED appointment on a
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
): Promise<void> {
  const ctx = await getAppointmentShareContext(clinicId, appointmentId, exec);

  // Always clear first so a re-snapshot (e.g. an edit that zeroed a share) can't
  // leave stale rows behind.
  await exec
    .delete(saleShares)
    .where(byClinic(saleShares.clinicId, clinicId, eq(saleShares.appointmentId, appointmentId)));

  if (!ctx.found || !ctx.occurredAt) return;

  // Each doctor earns his GROSS cut scaled by collected ÷ gross (the discount is
  // borne separately in the settlement ledger). `collected` is capped at the net
  // bill — the patient never pays more than they owe.
  const [appt] = await exec
    .select({ collected: appointments.amountCollected })
    .from(appointments)
    .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
    .limit(1);
  const collected = Math.max(0, Math.min(appt?.collected ?? 0, ctx.netEffective));
  const fraction = ctx.grossTotal > 0 ? collected / ctx.grossTotal : 0;

  const gross = computeShare({
    consultation: ctx.consultation,
    lines: ctx.lines,
    netTotal: ctx.grossTotal, // no discount → each doctor's full gross cut
    borneBy: "clinic",
  });
  const earning = Object.entries(gross.doctors)
    .map(([id, amt]) => [id, Math.round(amt * fraction)] as const)
    .filter(([, amt]) => amt > 0);
  if (earning.length === 0) return;

  // Name snapshots for the earning doctors (clinic-scoped).
  const ids = earning.map(([id]) => id);
  const names = new Map<string, string>();
  const rows = await exec
    .select({ id: users.id, fullName: users.fullName, username: users.username })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, inArray(users.id, ids)));
  for (const r of rows) names.set(r.id, r.fullName ?? r.username);

  await exec.insert(saleShares).values(
    earning.map(([doctorId, shareAmount]) => ({
      clinicId,
      appointmentId,
      doctorId,
      doctorName: names.get(doctorId) ?? null,
      shareAmount,
      occurredAt: ctx.occurredAt as Date,
    })),
  );
}

/**
 * Removes an appointment's per-doctor share rows (when it leaves "completed").
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
