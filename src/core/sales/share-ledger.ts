import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { appointments, saleShares, users } from "@/core/db/schema";
import { computeShare } from "@/core/appointments/shares";
import {
  getAppointmentShareContext,
  shareInputFromContext,
} from "@/core/appointments/share-context";

/**
 * Per-doctor share ledger — each doctor's earned share of a COMPLETED appointment,
 * on a **collected** basis (Finance Phase 2): a doctor earns his % of what the
 * patient has actually PAID, so his share scales by `collected ÷ bill`. The clinic's
 * cut is derived (sale net − Σ doctor shares), so only doctor rows are stored.
 * Recording REPLACES all rows for the appointment. Inert by default (no share % →
 * no rows). All best-effort — a hiccup here must never block whatever triggered it.
 */
export async function recordSaleSharesForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  try {
    const ctx = await getAppointmentShareContext(clinicId, appointmentId);

    // Always clear first so a re-snapshot (e.g. an edit that zeroed a share) can't
    // leave stale rows behind.
    await db
      .delete(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, eq(saleShares.appointmentId, appointmentId)));

    if (!ctx.found || !ctx.occurredAt) return;

    // Scale each doctor's FULL (billed) share by the fraction the patient has paid.
    const billNet = ctx.netEffective;
    const [appt] = await db
      .select({ collected: appointments.amountCollected })
      .from(appointments)
      .where(byClinic(appointments.clinicId, clinicId, eq(appointments.id, appointmentId)))
      .limit(1);
    const collected = Math.max(0, Math.min(appt?.collected ?? 0, billNet));
    const fraction = billNet > 0 ? collected / billNet : 0;

    const split = computeShare(shareInputFromContext(ctx));
    const earning = Object.entries(split.doctors)
      .map(([id, amt]) => [id, Math.round(amt * fraction)] as const)
      .filter(([, amt]) => amt > 0);
    if (earning.length === 0) return;

    // Name snapshots for the earning doctors (clinic-scoped).
    const ids = earning.map(([id]) => id);
    const names = new Map<string, string>();
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, username: users.username })
      .from(users)
      .where(byClinic(users.clinicId, clinicId, inArray(users.id, ids)));
    for (const r of rows) names.set(r.id, r.fullName ?? r.username);

    await db.insert(saleShares).values(
      earning.map(([doctorId, shareAmount]) => ({
        clinicId,
        appointmentId,
        doctorId,
        doctorName: names.get(doctorId) ?? null,
        shareAmount,
        occurredAt: ctx.occurredAt as Date,
      })),
    );
  } catch {
    // best-effort
  }
}

/** Removes an appointment's per-doctor share rows (when it leaves "completed"). */
export async function voidSaleSharesForAppointment(
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  try {
    await db
      .delete(saleShares)
      .where(byClinic(saleShares.clinicId, clinicId, eq(saleShares.appointmentId, appointmentId)));
  } catch {
    // best-effort
  }
}
