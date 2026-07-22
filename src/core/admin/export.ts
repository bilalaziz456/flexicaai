import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import {
  appointments,
  clinics,
  doctorLeaves,
  expenses,
  invoices,
  patientPayments,
  patients,
  procedures,
  recalls,
  users,
  visits,
} from "@/core/db/schema";

/**
 * Per-clinic data export (Feature 10) — a full JSON dump of ONE clinic's records
 * for support / migration / a departing customer. Cross-tenant admin read scoped
 * to the clinic, so `unscoped`. SECURITY: staff are exported WITHOUT auth secrets
 * (no password_hash / totp / session tokens).
 */
export async function exportClinicData(clinicId: string): Promise<Record<string, unknown> | null> {
  return unscoped("admin: export clinic data", async () => {
    const [clinic] = await db.select().from(clinics).where(eq(clinics.id, clinicId)).limit(1);
    if (!clinic) return null;

    const staff = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        prefix: users.prefix,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.clinicId, clinicId));

    const [
      patientRows,
      appointmentRows,
      visitRows,
      recallRows,
      procedureRows,
      paymentRows,
      invoiceRows,
      expenseRows,
      leaveRows,
    ] = await Promise.all([
      db.select().from(patients).where(eq(patients.clinicId, clinicId)),
      db.select().from(appointments).where(eq(appointments.clinicId, clinicId)),
      db.select().from(visits).where(eq(visits.clinicId, clinicId)),
      db.select().from(recalls).where(eq(recalls.clinicId, clinicId)),
      db.select().from(procedures).where(eq(procedures.clinicId, clinicId)),
      db.select().from(patientPayments).where(eq(patientPayments.clinicId, clinicId)),
      db.select().from(invoices).where(eq(invoices.clinicId, clinicId)),
      db.select().from(expenses).where(eq(expenses.clinicId, clinicId)),
      db.select().from(doctorLeaves).where(eq(doctorLeaves.clinicId, clinicId)),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      clinic: { ...clinic },
      counts: {
        staff: staff.length,
        patients: patientRows.length,
        appointments: appointmentRows.length,
        visits: visitRows.length,
      },
      staff,
      patients: patientRows,
      appointments: appointmentRows,
      visits: visitRows,
      recalls: recallRows,
      procedures: procedureRows,
      payments: paymentRows,
      invoices: invoiceRows,
      expenses: expenseRows,
      doctorLeaves: leaveRows,
    };
  });
}
