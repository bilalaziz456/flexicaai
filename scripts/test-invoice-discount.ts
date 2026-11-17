/**
 * Invoice discount (0154, owner 2026-11-17):
 *  - the pure rules: a % or a rupee amount off the invoice before tax, never more than
 *    it, and the one-time fees' share of it in proportion;
 *  - issuing writes the discount in rupees and a CREDIT carrying it to the clinic, split
 *    between subscription and fees, so neither balance still counts the rupees forgiven;
 *  - tax is on the discounted amount; the printout has the rupees;
 *  - editing changes the credit, removing the discount voids it, voiding / restoring the
 *    invoice takes the credit with it;
 *  - the credit cannot be voided alone, nor linked to an invoice as a payment.
 * Seeds its own clinic and removes it. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-invoice-discount.ts`
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { notDeleted } from "@/core/db/tenant";
import { clinicFees, clinicInvoices, clinicPayments, clinics, companySettings } from "@/core/db/schema";
import { discountFeeShare, invoiceDiscount, splitInvoiceDiscount } from "@/core/admin/invoice-status";
import { getClinicBilling, voidClinicPayment } from "@/core/admin/billing";
import { addClinicFee, clinicFeesOwed, feeLinesForInvoice, invoiceFeesOwed } from "@/core/admin/clinic-fees";
import {
  getClinicInvoiceForPrint,
  issueClinicInvoice,
  restoreClinicInvoice,
  setPaymentInvoice,
  updateClinicInvoice,
  voidClinicInvoice,
} from "@/core/admin/clinic-invoices";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function pureRules() {
  console.log("Pure rules:");
  ok("10% of 10,000 is 1,000", invoiceDiscount(10_000, { kind: "percent", value: 10 }) === 1_000);
  ok("Rs 1,500 is 1,500", invoiceDiscount(10_000, { kind: "amount", value: 1_500 }) === 1_500);
  ok("never more than the invoice", invoiceDiscount(10_000, { kind: "amount", value: 50_000 }) === 10_000);
  ok("over 100% is 100%", invoiceDiscount(10_000, { kind: "percent", value: 150 }) === 10_000);
  ok("none, 0 and negative are nothing", invoiceDiscount(10_000, null) === 0 && invoiceDiscount(10_000, { kind: "amount", value: -5 }) === 0);
  ok("12.5% rounds to whole rupees", invoiceDiscount(9_999, { kind: "percent", value: 12.5 }) === 1_250);
  ok("fees' share in proportion: 1,500 on 10,000 + 5,000 fees → 500", discountFeeShare(1_500, 5_000, 15_000) === 500);
  ok("no fees, no fee share", discountFeeShare(1_500, 0, 15_000) === 0);
  ok("a fees-only invoice: all of it", discountFeeShare(1_000, 5_000, 5_000) === 1_000);
  const feesOnly = splitInvoiceDiscount(10_000, 5_000, { kind: "percent", value: 10, on: "fees" });
  ok("10% on the fees only: 500, all of it off the fees", feesOnly.base === 5_000 && feesOnly.amount === 500 && feesOnly.feeShare === 500);
  const subOnly = splitInvoiceDiscount(10_000, 5_000, { kind: "percent", value: 10, on: "subscription" });
  ok("10% on the subscription only: 1,000, none off the fees", subOnly.base === 10_000 && subOnly.amount === 1_000 && subOnly.feeShare === 0);
  ok("Rs on the fees never more than the fees", splitInvoiceDiscount(10_000, 5_000, { kind: "amount", value: 9_000, on: "fees" }).amount === 5_000);
}

async function againstTheDatabase() {
  const tag = `disc${Date.now()}`;
  const actor = { id: "00000000-0000-0000-0000-000000000000", name: "discount test" };
  await unscoped("invoice discount test — seeds its own clinic", async () => {
    const activatedAt = new Date();
    activatedAt.setMonth(activatedAt.getMonth() - 1); // two months due (advance billing)
    const [c] = await db
      .insert(clinics)
      .values({ name: tag, modulesEnabled: [], monthlyPrice: 10_000, activatedAt, status: "active", graceDays: 0 })
      .returning({ id: clinics.id });
    const ids = [c.id];
    const [cfg] = await db.select({ next: companySettings.nextInvoiceNo }).from(companySettings).limit(1);
    const credit = async (invoiceId: string) =>
      (
        await db
          .select({ id: clinicPayments.id, amount: clinicPayments.amount, feeAmount: clinicPayments.feeAmount })
          .from(clinicPayments)
          .where(and(eq(clinicPayments.discountOfInvoiceId, invoiceId), notDeleted(clinicPayments.deletedAt)))
      )[0];
    try {
      const owedBefore = (await getClinicBilling(c.id))!.balance.owed;
      await addClinicFee({ clinicId: c.id, kind: "training_implementation", description: null, amount: 5_000, chargedOn: "2026-11-01", actor });
      const fees = await feeLinesForInvoice(c.id, (await (async () => {
        const r = await db.select({ id: clinicFees.id }).from(clinicFees).where(eq(clinicFees.clinicId, c.id));
        return r.map((x) => x.id);
      })()));
      if ("error" in fees) throw new Error(fees.error);

      console.log("Issuing with 10% off subscription + fees:");
      const res = await issueClinicInvoice(
        {
          clinicId: c.id,
          periodStart: null,
          periodEnd: null,
          amount: 10_000,
          feeLines: fees.lines,
          tax: { label: "Sales tax", rate: 16 },
          discount: { kind: "percent", value: 10 },
          note: null,
        },
        actor,
      );
      if ("error" in res) throw new Error(res.error);
      ok("numbered from 1001 (FA-INV-1001 onwards)", res.invoiceNo >= 1001, res.label);
      const [inv] = await db.select().from(clinicInvoices).where(eq(clinicInvoices.id, res.id));
      ok("discount stored in rupees: 1,500", inv.discountAmount === 1_500 && Number(inv.discountPercent) === 10);
      ok("amount is after it: 13,500", inv.amount === 13_500);
      ok("tax is on the discounted amount: 2,160", inv.taxAmount === 2_160);
      const cr = await credit(res.id);
      ok("a credit of 1,500 was written, 500 of it for the fees", cr?.amount === 1_500 && cr.feeAmount === 500, JSON.stringify(cr));
      const bal = (await getClinicBilling(c.id))!.balance;
      ok("the subscription balance dropped by its 1,000", bal.owed === owedBefore - 1_000, `${owedBefore} → ${bal.owed}`);
      ok("the fees still owed dropped by their 500", (await clinicFeesOwed(c.id)) === 4_500);
      ok("the invoice's open fees too (what a payment pays first)", (await invoiceFeesOwed(res.id)) === 4_500);
      const print = await getClinicInvoiceForPrint(res.id);
      ok(
        "the printout: subscription 10,000, discount 1,500, total 15,660",
        print?.subscriptionAmount === 10_000 && print.discountAmount === 1_500 && print.total === 15_660,
        JSON.stringify({ s: print?.subscriptionAmount, d: print?.discountAmount, t: print?.total }),
      );

      console.log("The credit follows the invoice:");
      ok("it cannot be voided on its own", "error" in (await voidClinicPayment(c.id, cr!.id, actor.id)));
      ok("nor linked to an invoice as a payment", "error" in (await setPaymentInvoice(c.id, cr!.id, res.id)));

      const e1 = await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: { kind: "amount", value: 600 }, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor);
      ok("editing to Rs 600 changes the credit to 600 (200 for fees)", "ok" in e1 && (await credit(res.id))?.amount === 600 && (await credit(res.id))?.feeAmount === 200);
      ok("a discount bigger than the invoice is refused", "error" in (await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: { kind: "amount", value: 99_999 }, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor)));
      await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: null, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor);
      ok("taking the discount off voids the credit", (await credit(res.id)) === undefined);
      ok("and the balance is back where it was", (await getClinicBilling(c.id))!.balance.owed === owedBefore);
      await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: { kind: "percent", value: 10 }, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor);
      ok("putting it back writes a new one", (await credit(res.id))?.amount === 1_500);

      console.log("What the discount is on:");
      const feesOwedBefore = 5_000;
      const e2 = await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: { kind: "percent", value: 10, on: "fees" }, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor);
      const [inv2] = await db.select().from(clinicInvoices).where(eq(clinicInvoices.id, res.id));
      ok("10% on the fees only: Rs 500, stored as 'fees'", "ok" in e2 && inv2.discountAmount === 500 && inv2.discountOn === "fees" && inv2.amount === 14_500);
      ok("its credit is all fee money", (await credit(res.id))?.amount === 500 && (await credit(res.id))?.feeAmount === 500);
      ok("the subscription balance is untouched", (await getClinicBilling(c.id))!.balance.owed === owedBefore);
      ok("the fees still owed drop by 500", (await clinicFeesOwed(c.id)) === feesOwedBefore - 500);
      ok("the printout names it", (await getClinicInvoiceForPrint(res.id))?.discountOn === "fees");
      ok("Rs 6,000 on Rs 5,000 of fees is refused", "error" in (await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: { kind: "amount", value: 6_000, on: "fees" }, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor)));
      await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: { kind: "amount", value: 2_000, on: "subscription" }, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor);
      ok("Rs 2,000 on the subscription only: no fee share", (await credit(res.id))?.amount === 2_000 && (await credit(res.id))?.feeAmount === 0);
      ok("so the fees are owed in full again", (await clinicFeesOwed(c.id)) === feesOwedBefore);
      await updateClinicInvoice(res.id, { amount: 10_000, tax: null, discount: { kind: "percent", value: 10 }, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor);

      await voidClinicInvoice(res.id, actor.id);
      ok("voiding the invoice voids its credit", (await credit(res.id)) === undefined);
      ok("and the balance is back where it was", (await getClinicBilling(c.id))!.balance.owed === owedBefore);
      await restoreClinicInvoice(res.id);
      const live = await db
        .select({ id: clinicPayments.id })
        .from(clinicPayments)
        .where(and(eq(clinicPayments.discountOfInvoiceId, res.id), notDeleted(clinicPayments.deletedAt)));
      ok("restoring brings back that one credit, not the one an edit removed", live.length === 1 && (await credit(res.id))?.amount === 1_500);
    } finally {
      await db.delete(clinicPayments).where(inArray(clinicPayments.clinicId, ids));
      await db.delete(clinicInvoices).where(inArray(clinicInvoices.clinicId, ids));
      await db.delete(clinicFees).where(inArray(clinicFees.clinicId, ids));
      await db.delete(clinics).where(inArray(clinics.id, ids));
      if (cfg) await db.update(companySettings).set({ nextInvoiceNo: cfg.next });
      console.log("seeded rows removed");
    }
  });
}

async function main() {
  pureRules();
  await againstTheDatabase();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
