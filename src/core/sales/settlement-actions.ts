import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic } from "@/core/db/tenant";
import { doctorSettlementActions, users } from "@/core/db/schema";
import { getDoctorBalance } from "@/core/sales/payouts";

/**
 * Settlement actions (discount-bearing phase 4) — the manual money moves on a doctor's
 * share balance, folded into `getDoctorBalances`:
 *   - `doctor_waive`  — the doctor forgoes his own share (relieves the clinic). −
 *   - `clinic_waive`  — the clinic forgives the doctor's deficit (a clinic cost). +
 *   - `write_off`     — the clinic writes a (departed) doctor's debt off. +
 *   - `repayment`     — the doctor pays the clinic to settle a deficit. +
 * Amounts are bounded to the relevant side of the balance so a move can't overshoot
 * zero. Void = delete (the balance simply moves back), mirroring `voidPayout`.
 * Permission is checked at the server-action layer (clinic-side needs `share_waive`; a
 * doctor waives his OWN share by identity).
 */
export type SettlementKind = "doctor_waive" | "clinic_waive" | "repayment" | "write_off";
const KINDS: SettlementKind[] = ["doctor_waive", "clinic_waive", "repayment", "write_off"];

type Actor = { id: string; name: string };

export type SettlementActionRow = {
  id: string;
  doctorId: string | null;
  doctorName: string | null;
  kind: string;
  amount: number;
  appointmentId: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: Date;
};

export async function recordSettlementAction(
  clinicId: string,
  input: {
    doctorId: string;
    kind: SettlementKind;
    amount: number;
    appointmentId?: string | null;
    lineRef?: string | null;
    note?: string | null;
    actor: Actor;
  },
): Promise<{ id: string; outstanding: number } | { error: string }> {
  if (!KINDS.includes(input.kind)) return { error: "Unknown action." };
  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };

  const [doctor] = await db
    .select({ fullName: users.fullName, username: users.username })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, eq(users.id, input.doctorId)))
    .limit(1);
  if (!doctor) return { error: "Doctor not found." };

  const bal = await getDoctorBalance(clinicId, input.doctorId);
  const owedToDoctor = Math.max(0, bal.outstanding); // clinic owes the doctor
  const owedByDoctor = Math.max(0, -bal.outstanding); // the doctor owes the clinic

  if (input.kind === "doctor_waive") {
    if (owedToDoctor <= 0) return { error: "This doctor isn't owed anything to waive." };
    if (amount > owedToDoctor) return { error: `A doctor can only waive up to what they're owed (Rs ${owedToDoctor}).` };
  } else {
    // clinic_waive / write_off / repayment all relieve a doctor's DEBT.
    if (owedByDoctor <= 0) return { error: "This doctor doesn't owe anything." };
    if (amount > owedByDoctor) return { error: `Amount exceeds what the doctor owes (Rs ${owedByDoctor}).` };
  }

  const [row] = await db
    .insert(doctorSettlementActions)
    .values({
      clinicId,
      doctorId: input.doctorId,
      doctorName: doctor.fullName ?? doctor.username,
      appointmentId: input.appointmentId ?? null,
      lineRef: input.lineRef ?? null,
      kind: input.kind,
      amount,
      note: input.note?.slice(0, 500) ?? null,
      createdBy: input.actor.id,
      createdByName: input.actor.name,
    })
    .returning({ id: doctorSettlementActions.id });

  const delta = input.kind === "doctor_waive" ? -amount : amount;
  return { id: row.id, outstanding: bal.outstanding + delta };
}

/** Delete a settlement action (a correction) — the balance moves back. Clinic-scoped. */
export async function voidSettlementAction(clinicId: string, actionId: string): Promise<boolean> {
  const [row] = await db
    .delete(doctorSettlementActions)
    .where(byClinic(doctorSettlementActions.clinicId, clinicId, eq(doctorSettlementActions.id, actionId)))
    .returning({ id: doctorSettlementActions.id });
  return Boolean(row);
}

/** Recent settlement actions for a clinic, optionally scoped to one doctor. */
export async function listSettlementActions(
  clinicId: string,
  doctorId?: string | null,
  limit = 100,
): Promise<SettlementActionRow[]> {
  return db
    .select({
      id: doctorSettlementActions.id,
      doctorId: doctorSettlementActions.doctorId,
      doctorName: doctorSettlementActions.doctorName,
      kind: doctorSettlementActions.kind,
      amount: doctorSettlementActions.amount,
      appointmentId: doctorSettlementActions.appointmentId,
      note: doctorSettlementActions.note,
      createdByName: doctorSettlementActions.createdByName,
      createdAt: doctorSettlementActions.createdAt,
    })
    .from(doctorSettlementActions)
    .where(
      byClinic(
        doctorSettlementActions.clinicId,
        clinicId,
        doctorId ? eq(doctorSettlementActions.doctorId, doctorId) : undefined,
      ),
    )
    .orderBy(desc(doctorSettlementActions.createdAt))
    .limit(limit);
}
