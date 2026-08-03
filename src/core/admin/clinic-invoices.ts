import "server-only";

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { newDeleteGroup, restoreValues, softDeleteValues } from "@/core/db/soft-delete";
import { clinicInvoices, clinics, companySettings } from "@/core/db/schema";
import {
  bucketLabel,
  nextBucket,
  startOfBucket,
  type ResolvedRange,
} from "@/core/sales/report";

/**
 * Clinic subscription invoices (Owner Finance, Phase 4) — invoices FlexicaAI issues TO
 * clinics for their subscription. CORE, company control-plane. `clinic_invoices`
 * carries `clinic_id`, so cross-tenant reads run `unscoped`; the number comes from a
 * company-global counter (`company_settings`) allocated under a row lock, mirroring
 * the patient-invoice pattern one tier up. ACL + audit live in the action layer.
 */

const p2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** Seed + read the singleton company settings (counter + prefix). */
export async function getCompanyInvoiceSettings(): Promise<{ nextInvoiceNo: number; invoicePrefix: string }> {
  const [row] = await db.select().from(companySettings).limit(1);
  if (row) return { nextInvoiceNo: row.nextInvoiceNo, invoicePrefix: row.invoicePrefix };
  const [created] = await db.insert(companySettings).values({}).returning();
  return { nextInvoiceNo: created.nextInvoiceNo, invoicePrefix: created.invoicePrefix };
}

export type IssueInvoiceInput = {
  clinicId: string;
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
  amount: number;
  note: string | null;
};

/** Issues a numbered subscription invoice; allocates the company-global number under
 *  a row lock so concurrent issues never collide. */
export async function issueClinicInvoice(
  input: IssueInvoiceInput,
  actor: { id: string; name: string },
): Promise<{ id: string; invoiceNo: number; label: string } | { error: string }> {
  return unscoped("admin: issue clinic invoice", async () => {
    const [clinic] = await db.select({ id: clinics.id }).from(clinics).where(and(eq(clinics.id, input.clinicId), notDeleted(clinics.deletedAt))).limit(1);
    if (!clinic) return { error: "Clinic not found." };

    return db.transaction(async (tx) => {
      // Lock the singleton settings row so number allocation serializes.
      let [cfg] = await tx.select().from(companySettings).for("update").limit(1);
      if (!cfg) [cfg] = await tx.insert(companySettings).values({}).returning();
      const allocated = cfg.nextInvoiceNo;
      await tx.update(companySettings).set({ nextInvoiceNo: allocated + 1, updatedAt: new Date() }).where(eq(companySettings.id, cfg.id));

      const [inv] = await tx
        .insert(clinicInvoices)
        .values({
          clinicId: input.clinicId,
          invoiceNo: allocated,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          amount: Math.max(0, Math.round(input.amount)),
          note: input.note?.slice(0, 500) || null,
          issuedBy: actor.id,
          issuedByName: actor.name,
        })
        .returning({ id: clinicInvoices.id });

      return { id: inv.id, invoiceNo: allocated, label: `${cfg.invoicePrefix}${allocated}` };
    });
  });
}

export type ClinicInvoiceRow = {
  id: string;
  invoiceNo: number;
  label: string;
  clinicName: string;
  periodStart: string | null;
  periodEnd: string | null;
  amount: number;
  issuedAt: Date;
  issuedByName: string | null;
  deleted: boolean;
};

export type InvoiceFilters = {
  clinicId?: string;
  from?: Date;
  toExclusive?: Date;
  deleted?: boolean;
  limit?: number;
  offset?: number;
};

export async function listClinicInvoices(filters: InvoiceFilters): Promise<{ rows: ClinicInvoiceRow[]; total: number }> {
  return unscoped("admin: list clinic invoices", async () => {
    const { invoicePrefix } = await getCompanyInvoiceSettings();
    const parts = [
      filters.deleted ? sql`${clinicInvoices.deletedAt} is not null` : notDeleted(clinicInvoices.deletedAt),
    ];
    if (filters.clinicId) parts.push(eq(clinicInvoices.clinicId, filters.clinicId));
    if (filters.from) parts.push(gte(clinicInvoices.issuedAt, filters.from));
    if (filters.toExclusive) parts.push(lt(clinicInvoices.issuedAt, filters.toExclusive));
    const where = and(...parts);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          id: clinicInvoices.id,
          invoiceNo: clinicInvoices.invoiceNo,
          clinicName: clinics.name,
          periodStart: clinicInvoices.periodStart,
          periodEnd: clinicInvoices.periodEnd,
          amount: clinicInvoices.amount,
          issuedAt: clinicInvoices.issuedAt,
          issuedByName: clinicInvoices.issuedByName,
          deletedAt: clinicInvoices.deletedAt,
        })
        .from(clinicInvoices)
        .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
        .where(where)
        .orderBy(desc(clinicInvoices.invoiceNo))
        .limit(filters.limit ?? 50)
        .offset(filters.offset ?? 0),
      db.select({ total: sql<number>`count(*)::int` }).from(clinicInvoices).where(where),
    ]);
    return {
      rows: rows.map((r) => ({ ...r, label: `${invoicePrefix}${r.invoiceNo}`, deleted: r.deletedAt !== null })),
      total: Number(total),
    };
  });
}

/** Σ invoiced (live) in a range — the KPI. */
export async function invoicedTotal(from: Date, toExclusive: Date): Promise<number> {
  return unscoped("admin: invoiced total", async () => {
    const [row] = await db
      .select({ t: sql<number>`coalesce(sum(${clinicInvoices.amount}), 0)::int` })
      .from(clinicInvoices)
      .where(and(notDeleted(clinicInvoices.deletedAt), gte(clinicInvoices.issuedAt, from), lt(clinicInvoices.issuedAt, toExclusive)));
    return Number(row?.t ?? 0);
  });
}

/** Per-bucket invoiced total over a resolved range — the trend chart. */
export async function invoicedTrend(range: ResolvedRange): Promise<{ label: string; total: number }[]> {
  const { start, end, granularity } = range;
  return unscoped("admin: invoiced trend", async () => {
    const rows = await db
      .select({ issuedAt: clinicInvoices.issuedAt, amount: clinicInvoices.amount })
      .from(clinicInvoices)
      .where(and(notDeleted(clinicInvoices.deletedAt), gte(clinicInvoices.issuedAt, start), lt(clinicInvoices.issuedAt, end)));
    const buckets: { label: string; total: number }[] = [];
    const index = new Map<number, number>();
    for (let cur = startOfBucket(start, granularity); cur < end; cur = nextBucket(cur, granularity)) {
      index.set(cur.getTime(), buckets.length);
      buckets.push({ label: bucketLabel(cur, granularity), total: 0 });
    }
    for (const r of rows) {
      const idx = index.get(startOfBucket(r.issuedAt, granularity).getTime());
      if (idx !== undefined) buckets[idx].total += r.amount;
    }
    return buckets;
  });
}

export async function voidClinicInvoice(id: string, actorId: string): Promise<boolean> {
  return unscoped("admin: void clinic invoice", async () => {
    const res = await db
      .update(clinicInvoices)
      .set(softDeleteValues(actorId, newDeleteGroup()))
      .where(and(notDeleted(clinicInvoices.deletedAt), eq(clinicInvoices.id, id)))
      .returning({ id: clinicInvoices.id });
    return res.length > 0;
  });
}

export async function restoreClinicInvoice(id: string): Promise<boolean> {
  return unscoped("admin: restore clinic invoice", async () => {
    const res = await db
      .update(clinicInvoices)
      .set(restoreValues())
      .where(eq(clinicInvoices.id, id))
      .returning({ id: clinicInvoices.id });
    return res.length > 0;
  });
}

export type ClinicInvoicePrint = {
  label: string;
  invoiceNo: number;
  amount: number;
  periodStart: string | null;
  periodEnd: string | null;
  note: string | null;
  issuedAt: Date;
  issuedByName: string | null;
  clinic: { name: string; ownerName: string | null; ownerEmail: string | null; ownerPhone: string | null; city: string | null; country: string | null; address: string | null };
};

/** One invoice + its clinic (bill-to) for the printable receipt. */
export async function getClinicInvoiceForPrint(id: string): Promise<ClinicInvoicePrint | null> {
  return unscoped("admin: clinic invoice print", async () => {
    const { invoicePrefix } = await getCompanyInvoiceSettings();
    const [row] = await db
      .select({
        invoiceNo: clinicInvoices.invoiceNo,
        amount: clinicInvoices.amount,
        periodStart: clinicInvoices.periodStart,
        periodEnd: clinicInvoices.periodEnd,
        note: clinicInvoices.note,
        issuedAt: clinicInvoices.issuedAt,
        issuedByName: clinicInvoices.issuedByName,
        name: clinics.name,
        ownerName: clinics.ownerName,
        ownerEmail: clinics.ownerEmail,
        ownerPhone: clinics.ownerPhone,
        city: clinics.city,
        country: clinics.country,
        address: clinics.address,
      })
      .from(clinicInvoices)
      .innerJoin(clinics, eq(clinics.id, clinicInvoices.clinicId))
      .where(and(notDeleted(clinicInvoices.deletedAt), eq(clinicInvoices.id, id)))
      .limit(1);
    if (!row) return null;
    return {
      label: `${invoicePrefix}${row.invoiceNo}`,
      invoiceNo: row.invoiceNo,
      amount: row.amount,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      note: row.note,
      issuedAt: row.issuedAt,
      issuedByName: row.issuedByName,
      clinic: {
        name: row.name,
        ownerName: row.ownerName,
        ownerEmail: row.ownerEmail,
        ownerPhone: row.ownerPhone,
        city: row.city,
        country: row.country,
        address: row.address,
      },
    };
  });
}

/** ISO helper re-exported for the action layer's period defaults. */
export { isoDate };
