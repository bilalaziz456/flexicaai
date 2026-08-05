import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, softDeleteValues } from "@/core/db/soft-delete";
import { patients } from "@/core/db/schema";
import { labCases } from "@/modules/dental/db/schema";
import type { LabCaseData, ModuleLab } from "@/core/types/module";
import { serverEnv } from "@/core/lib/env";
import { sendWhatsAppToPatient } from "@/core/notifications/whatsapp";

/**
 * Dental lab cases — MODULE data layer (server-only). A crown/denture goes to a lab;
 * status moves sent → in_lab → received → fitted (or remake). When it's `received`
 * (back from the lab), the patient gets a "your crown is ready" WhatsApp. Clinic-scoped.
 */

const STATUSES = ["sent", "in_lab", "received", "fitted", "remake"];
const ITEM_TYPES = ["crown", "bridge", "denture", "veneer", "inlay/onlay", "implant crown", "retainer", "other"];

function toData(row: typeof labCases.$inferSelect): LabCaseData {
  return {
    id: row.id,
    labName: row.labName,
    item: row.item,
    tooth: row.tooth,
    shade: row.shade,
    status: row.status,
    dueAt: row.dueAt,
    cost: row.cost,
    note: row.note,
    createdAt: row.createdAt,
  };
}

async function listLabCases(clinicId: string, patientId: string): Promise<LabCaseData[]> {
  const rows = await db
    .select()
    .from(labCases)
    .where(
      byClinic(labCases.clinicId, clinicId, notDeleted(labCases.deletedAt), eq(labCases.patientId, patientId)),
    )
    .orderBy(desc(labCases.createdAt));
  return rows.map(toData);
}

async function saveLabCase(
  clinicId: string,
  patientId: string,
  input: { labName?: string | null; item: string; tooth?: string | null; shade?: string | null; dueAt?: string | null; cost?: number | null; note?: string | null },
): Promise<void> {
  await db.insert(labCases).values({
    clinicId,
    patientId,
    labName: input.labName?.slice(0, 120) || null,
    item: input.item.slice(0, 60) || "crown",
    tooth: input.tooth?.slice(0, 4) || null,
    shade: input.shade?.slice(0, 20) || null,
    status: "sent",
    sentAt: new Date(),
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    cost: input.cost != null ? Math.max(0, Math.round(input.cost)) : null,
    note: input.note?.slice(0, 500) || null,
  });
}

/** "Your crown is ready" — best-effort WhatsApp when a case comes back from the lab. */
async function notifyReady(clinicId: string, patientId: string, item: string): Promise<void> {
  try {
    const [pt] = await db
      .select({ name: patients.fullName, phone: patients.phone })
      .from(patients)
      .where(byClinic(patients.clinicId, clinicId, eq(patients.id, patientId)))
      .limit(1);
    if (!pt?.phone) return;
    await sendWhatsAppToPatient({
      clinicId,
      patientId,
      phone: pt.phone,
      campaignName: serverEnv.AISENSY_LAB_CAMPAIGN,
      userName: pt.name,
      templateParams: [pt.name, item],
      body: `Good news: your ${item} is back from the lab and ready to fit. Please call to book your fitting.`,
    });
  } catch {
    // Best-effort — a notify failure never blocks the status change.
  }
}

async function updateLabStatus(clinicId: string, caseId: string, status: string): Promise<void> {
  if (!STATUSES.includes(status)) return;
  const [row] = await db
    .update(labCases)
    .set({
      status,
      receivedAt: status === "received" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(byClinic(labCases.clinicId, clinicId, notDeleted(labCases.deletedAt), eq(labCases.id, caseId)))
    .returning({ patientId: labCases.patientId, item: labCases.item });
  if (row && status === "received") {
    await notifyReady(clinicId, row.patientId, row.item);
  }
}

async function deleteLabCase(clinicId: string, caseId: string, actorId: string): Promise<void> {
  await db
    .update(labCases)
    .set(softDeleteValues(actorId, newDeleteGroup()))
    .where(byClinic(labCases.clinicId, clinicId, notDeleted(labCases.deletedAt), eq(labCases.id, caseId)));
}

/** The dental `ModuleLab` bundle for the clinical-record contract. */
export const dentalLab: ModuleLab = {
  statuses: STATUSES,
  itemTypes: ITEM_TYPES,
  loadCases: listLabCases,
  saveCase: (clinicId, patientId, input) => saveLabCase(clinicId, patientId, input),
  updateStatus: updateLabStatus,
  deleteCase: deleteLabCase,
};
