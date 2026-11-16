/**
 * One-time fees (training, implementation… migration 0152, owner 2026-11-17):
 *  - the pure rules: a payment's subscription and fee shares, fees-first default,
 *    spreading fee money over the fees oldest first;
 *  - fee money is NEVER counted as subscription months: a payment wholly for fees
 *    leaves the subscription balance exactly where it was, in the full balance, the
 *    one-aggregate summary and the dues list alike;
 *  - a fee is "invoiced" only while a LIVE invoice lists it: issuing bills it, voiding
 *    frees it, and a restore that would bill it twice is refused;
 *  - the invoice total includes the fees and the subscription line is the rest;
 *  - the P&L splits collected revenue into subscription and one-time fees.
 * Seeds its own clinic, fees, invoices and payments, and removes them. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-clinic-fees.ts`
 */
import { inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { clinicFees, clinicInvoices, clinicPayments, clinics, companySettings } from "@/core/db/schema";
import {
  allocateFeePayments,
  defaultFeeShare,
  signedFeeShare,
  subscriptionShare,
} from "@/core/admin/clinic-fee-rules";
import { getClinicBalanceSummary, getClinicBilling, listDueClinics, recordClinicPayment } from "@/core/admin/billing";
import {
  addClinicFee,
  clinicFeesOwed,
  feeLinesForInvoice,
  getClinicFees,
  invoiceFeesOwed,
  invoiceFeesStillFree,
  listUninvoicedFees,
} from "@/core/admin/clinic-fees";
import { getClinicInvoiceForPrint, issueClinicInvoice, listClinicInvoices, voidClinicInvoice } from "@/core/admin/clinic-invoices";
import { getCompanyPnl } from "@/core/admin/pnl";

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
  ok("a plain payment is all subscription", subscriptionShare({ amount: 1000, feeAmount: 0, kind: "payment" }) === 1000);
  ok("a split payment gives its fee share to fees", subscriptionShare({ amount: 1000, feeAmount: 300, kind: "payment" }) === 700);
  ok("a fee share above the amount is clamped", subscriptionShare({ amount: 1000, feeAmount: 5000, kind: "payment" }) === 0);
  ok("a credit is never fee money", subscriptionShare({ amount: 500, feeAmount: 200, kind: "credit" }) === 500 && signedFeeShare({ amount: 500, feeAmount: 200, kind: "credit" }) === 0);
  ok("a refund's fee share comes off the fees", signedFeeShare({ amount: 1000, feeAmount: 400, kind: "refund" }) === -400);
  ok("fees first: up to what is owed", defaultFeeShare(25_000, 50_000) === 25_000 && defaultFeeShare(80_000, 50_000) === 50_000);
  ok("fees first: nothing owed, nothing to fees", defaultFeeShare(10_000, 0) === 0);
  const a = allocateFeePayments([{ amount: 20_000 }, { amount: 30_000 }], 25_000);
  ok("fee money pays the oldest fee first", a.fees[0].paid === 20_000 && a.fees[1].paid === 5_000 && a.owed === 25_000);
  const b = allocateFeePayments([{ amount: 1000 }], 1500);
  ok("fee money beyond the fees is reported as extra", b.paid === 1000 && b.extra === 500 && b.owed === 0);
}

async function againstTheDatabase() {
  const tag = `t${Date.now()}`;
  const actor = { id: "00000000-0000-0000-0000-000000000000", name: "fee test" };
  await unscoped("one-time fee test — seeds its own clinic", async () => {
    const activatedAt = new Date();
    activatedAt.setMonth(activatedAt.getMonth() - 1); // two months due (advance billing)
    const [c] = await db
      .insert(clinics)
      .values({ name: `fees${tag}`, modulesEnabled: [], monthlyPrice: 10_000, activatedAt, status: "active", graceDays: 0 })
      .returning({ id: clinics.id });
    const ids = [c.id];
    // Issuing takes real numbers from the company counter; put it back afterwards.
    const [cfg] = await db.select({ next: companySettings.nextInvoiceNo }).from(companySettings).limit(1);
    try {
      const before = await getClinicBilling(c.id);
      ok("before: nothing paid on the subscription", before!.balance.totalPaid === 0 && before!.balance.owed === 20_000);

      await addClinicFee({ clinicId: c.id, kind: "training", description: null, amount: 20_000, chargedOn: "2026-01-01", actor });
      await addClinicFee({ clinicId: c.id, kind: "implementation", description: "Setup", amount: 30_000, chargedOn: "2026-01-02", actor });
      ok("fees owed after adding two", (await clinicFeesOwed(c.id)) === 50_000);

      console.log("Fee money is never months paid:");
      const fee1 = defaultFeeShare(25_000, await clinicFeesOwed(c.id));
      await recordClinicPayment({ clinicId: c.id, amount: 25_000, kind: "payment", feeAmount: fee1 });
      const after = await getClinicBilling(c.id);
      ok("a fees-only payment leaves the subscription unpaid", after!.balance.totalPaid === 0 && after!.balance.owed === 20_000 && after!.balance.monthsPaid === 0,
        `paid ${after!.balance.totalPaid}, owed ${after!.balance.owed}`);
      const summary = await getClinicBalanceSummary({ ...after!.clinic, id: c.id });
      ok("the one-aggregate summary agrees", summary.owed === after!.balance.owed && summary.totalPaid === after!.balance.totalPaid);
      const due = (await listDueClinics()).find((d) => d.id === c.id);
      ok("the dues list agrees", due !== undefined && due.balance.owed === 20_000, JSON.stringify(due?.balance ?? null));
      const fees = await getClinicFees(c.id);
      ok("training paid in full, implementation Rs 5,000 paid", fees.fees[0].paid === 20_000 && fees.fees[1].paid === 5_000 && fees.owed === 25_000);

      // A payment bigger than the fees still owed: the rest is subscription.
      const fee2 = defaultFeeShare(45_000, await clinicFeesOwed(c.id));
      await recordClinicPayment({ clinicId: c.id, amount: 45_000, kind: "payment", feeAmount: fee2 });
      const after2 = await getClinicBilling(c.id);
      ok("the rest of a payment goes to the subscription", fee2 === 25_000 && after2!.balance.totalPaid === 20_000 && after2!.balance.owed === 0);
      ok("fees now fully paid", (await clinicFeesOwed(c.id)) === 0);

      console.log("Fees on invoices:");
      const open = await listUninvoicedFees([c.id]);
      ok("both fees are open to invoice", open.length === 2);
      const lines = await feeLinesForInvoice(c.id, open.map((f) => f.id));
      if ("error" in lines) throw new Error(lines.error);
      const inv = await issueClinicInvoice(
        { clinicId: c.id, periodStart: "2026-01-01", periodEnd: "2026-01-31", amount: 10_000, feeLines: lines.lines, note: null },
        actor,
      );
      if ("error" in inv) throw new Error(inv.error);
      const row = (await listClinicInvoices({ clinicId: c.id })).rows.find((r) => r.id === inv.id)!;
      ok("invoice amount = subscription + fees", row.amount === 60_000 && row.feeAmount === 50_000);
      const print = await getClinicInvoiceForPrint(inv.id);
      ok("the printout has two fee lines and a Rs 10,000 subscription line", print!.feeLines.length === 2 && print!.subscriptionAmount === 10_000);
      ok("invoiced fees are no longer open", (await listUninvoicedFees([c.id])).length === 0);
      // The clinic page's "Invoice" column — a select-list subquery, which once compared
      // the fee with the invoice's own id and called every fee "not invoiced".
      const listed = await getClinicFees(c.id);
      ok("the clinic page names the invoice on each fee", listed.fees.every((f) => f.invoiceLabel !== null), JSON.stringify(listed.fees.map((f) => f.invoiceLabel)));
      ok("a fee cannot be billed twice", "error" in (await feeLinesForInvoice(c.id, [open[0].id])));
      ok("fees owed on the invoice before any payment against it", (await invoiceFeesOwed(inv.id)) === 50_000);

      await voidClinicInvoice(inv.id, actor.id);
      ok("voiding the invoice frees its fees", (await listUninvoicedFees([c.id])).length === 2);
      ok("a voided invoice whose fees are still free may be restored", await invoiceFeesStillFree(inv.id));
      const again = await feeLinesForInvoice(c.id, [open[0].id]);
      if ("error" in again) throw new Error(again.error);
      const inv2 = await issueClinicInvoice({ clinicId: c.id, periodStart: null, periodEnd: null, amount: 0, feeLines: again.lines, note: null }, actor);
      if ("error" in inv2) throw new Error(inv2.error);
      ok("a fee-only invoice: no subscription line", (await getClinicInvoiceForPrint(inv2.id))!.subscriptionAmount === 0);
      ok("restoring the first would bill training twice — refused", !(await invoiceFeesStillFree(inv.id)));

      console.log("P&L:");
      const start = new Date(Date.now() - 60_000);
      const end = new Date(Date.now() + 60_000);
      const pnl = await getCompanyPnl({ start, end, granularity: "day" } as Parameters<typeof getCompanyPnl>[0]);
      ok("one-time fees counted apart from subscription", pnl.feeRevenue >= 50_000 && pnl.subscriptionRevenue + pnl.feeRevenue === pnl.revenue,
        `fees ${pnl.feeRevenue}, subscription ${pnl.subscriptionRevenue}, total ${pnl.revenue}`);
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
