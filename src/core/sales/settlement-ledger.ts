import "server-only";

import { eq, inArray } from "drizzle-orm";
import { byClinic } from "@/core/db/tenant";
import type { Executor } from "@/core/db/tx";
import { discountSettlements, users } from "@/core/db/schema";
import { computeShare } from "@/core/appointments/shares";
import { computeBearing } from "@/core/appointments/discount-bearing";
import { getAppointmentShareContext } from "@/core/appointments/share-context";
import type { SettlementPartyCode } from "@/core/db/vocabulary-seed";

/**
 * Discount settlement ledger (discount-bearing, phase 2) — snapshots how a completed
 * visit's EFFECTIVE (approved) discount is borne between the clinic and its doctor(s),
 * per docs/discount-bearing-plan.md §3. The bearing party absorbs it in full (no
 * spillover); the settlement is a zero-sum transfer computed on the NET bill + gross
 * shares (collection-independent), so it doesn't move when the patient pays. Recording
 * REPLACES all rows for the appointment. Takes an executor and THROWS on failure —
 * one step of the derived-write transaction; the outer boundary is the only
 * best-effort one (ADR-016).
 *
 * NOTE (phase 2): this is a SHADOW ledger — it is written on the completion hook but
 * nothing reads it yet; the reader cutover (balances / reports / P&L) is a later phase.
 */
export async function recordDiscountSettlementForAppointment(
  clinicId: string,
  appointmentId: string,
  exec: Executor,
): Promise<void> {
    const ctx = await getAppointmentShareContext(clinicId, appointmentId, exec);

    // Replace-all: clear first so an edit that removed the discount leaves nothing.
    await exec
      .delete(discountSettlements)
      .where(byClinic(discountSettlements.clinicId, clinicId, eq(discountSettlements.appointmentId, appointmentId)));

    if (!ctx.found || !ctx.occurredAt) return;

    // The EFFECTIVE discount (a pending/rejected one is gated to 0 via netEffective).
    const discount = Math.max(0, ctx.grossTotal - ctx.netEffective);
    if (discount <= 0) return;

    // Each party's pre-discount gross cut (no discount → full gross share).
    const gross = computeShare({
      consultation: ctx.consultation,
      lines: ctx.lines,
      netTotal: ctx.grossTotal,
      borneBy: "clinic",
    });
    const clinicGross = gross.clinic;
    const doctorGross = gross.doctors;

    const bearing = computeBearing({
      clinicGross,
      doctorGross,
      discount,
      borneBy: ctx.borneBy,
      split: { type: ctx.discountSplitType === "amount" ? "amount" : "percent", value: ctx.discountSplitValue },
    });

    // Rows for every party that actually bears/receives something (Σ = 0).
    type Row = {
      party: SettlementPartyCode;
      doctorId: string | null;
      settlementAmount: number;
      grossShare: number;
    };
    const rows: Row[] = [];
    if (bearing.clinic !== 0) {
      rows.push({ party: "clinic", doctorId: null, settlementAmount: bearing.clinic, grossShare: clinicGross });
    }
    for (const [doctorId, amt] of Object.entries(bearing.doctors)) {
      if (amt !== 0) rows.push({ party: "doctor", doctorId, settlementAmount: amt, grossShare: doctorGross[doctorId] ?? 0 });
    }
    if (rows.length === 0) return;

    // Name snapshots for the doctor rows (clinic-scoped).
    const doctorIds = rows.map((r) => r.doctorId).filter((v): v is string => Boolean(v));
    const names = new Map<string, string>();
    if (doctorIds.length > 0) {
      const nameRows = await exec
        .select({ id: users.id, fullName: users.fullName, username: users.username })
        .from(users)
        .where(byClinic(users.clinicId, clinicId, inArray(users.id, doctorIds)));
      for (const r of nameRows) names.set(r.id, r.fullName ?? r.username);
    }

    await exec.insert(discountSettlements).values(
      rows.map((r) => ({
        clinicId,
        appointmentId,
        party: r.party,
        doctorId: r.doctorId,
        doctorName: r.doctorId ? (names.get(r.doctorId) ?? null) : null,
        grossShare: r.grossShare,
        settlementAmount: r.settlementAmount,
        occurredAt: ctx.occurredAt as Date,
      })),
    );
}

/** Removes an appointment's settlement rows (when it leaves "completed"). Throws on
 *  failure — one step of the derived-write transaction (ADR-016). */
export async function voidDiscountSettlementForAppointment(
  clinicId: string,
  appointmentId: string,
  exec: Executor,
): Promise<void> {
  await exec
    .delete(discountSettlements)
    .where(byClinic(discountSettlements.clinicId, clinicId, eq(discountSettlements.appointmentId, appointmentId)));
}
