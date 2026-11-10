/**
 * Subscription invoice status (owner's call, 2026-11-11):
 *  - the pure rules: Paid / Partly paid / Unpaid, Overdue only after the due date, a
 *    refund against an invoice takes its money back, a zero invoice is paid;
 *  - the SQL agrees with them: each invoice's `paid` is the sum of the live payments
 *    recorded against it (a voided payment does not count), and each status filter
 *    returns exactly the invoices the pure rules put in that bucket;
 *  - the list's summary is the whole filtered set's (outstanding, overdue);
 *  - a payment can only be linked to one of its own clinic's live invoices.
 * Seeds its own clinics, invoices (with numbers far above the real sequence, so the
 * company counter is untouched) and payments, and removes them. Run:
 * `tsx --env-file=.env.local --tsconfig scripts/_seed/tsconfig.json scripts/test-invoice-status.ts`
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import { unscoped } from "@/core/db/tenant-guard";
import { clinicInvoices, clinicPayments, clinics } from "@/core/db/schema";
import { isLiveInvoiceOfClinic, listClinicInvoices, setPaymentInvoice, updateClinicInvoice } from "@/core/admin/clinic-invoices";
import {
  formatIsoDay,
  formatPeriod,
  formatRate,
  invoiceStatus,
  invoiceTax,
  invoiceStatusLabel,
  localIsoDate,
  type InvoiceStatusFilter,
} from "@/core/admin/invoice-status";

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
  const T = "2026-11-11";
  const s = (amount: number, paid: number, due: string | null) => invoiceStatus(amount, paid, due, T);
  ok("nothing paid, not yet due → Unpaid", invoiceStatusLabel(s(1000, 0, "2026-11-20")) === "Unpaid");
  ok("due TODAY is not yet overdue", !s(1000, 0, T).overdue);
  ok("nothing paid, past due → Overdue", invoiceStatusLabel(s(1000, 0, "2026-11-10")) === "Overdue");
  ok("some paid → Partly paid, balance is the rest", s(1000, 400, "2026-11-20").state === "partly_paid" && s(1000, 400, null).balance === 600);
  ok("some paid, past due → Partly paid · overdue", invoiceStatusLabel(s(1000, 400, "2026-11-01")) === "Partly paid · overdue");
  ok("paid in full → Paid, never overdue", invoiceStatusLabel(s(1000, 1000, "2026-01-01")) === "Paid");
  ok("paid beyond → Paid, the excess is reported", s(1000, 1200, null).overpaid === 200 && s(1000, 1200, null).balance === 0);
  ok("a zero invoice is paid", s(0, 0, "2026-01-01").state === "paid");
  ok("a refund that leaves nothing paid → Unpaid", s(1000, 0, null).state === "unpaid");
  ok("no due date → never overdue", !s(1000, 0, null).overdue);
  ok("dates print as words", formatIsoDay("2026-11-04") === "4 Nov 2026");
  ok("a period prints as a range", formatPeriod("2026-11-04", "2026-12-04") === "4 Nov 2026 – 4 Dec 2026");
  ok("no period → null", formatPeriod(null, null) === null);
  ok("tax: 16% of Rs 15,000 is Rs 2,400", invoiceTax(15000, 16) === 2400);
  ok("tax rounds to the rupee (333 × 4.5% = 14.985 → 15)", invoiceTax(333, 4.5) === 15);
  ok("no rate, zero or negative → no tax", invoiceTax(1000, null) === 0 && invoiceTax(1000, 0) === 0 && invoiceTax(1000, -5) === 0);
  ok("a rate prints as written", formatRate("16.00") === "16" && formatRate(4.5) === "4.5");
}

async function againstTheDatabase() {
  const tag = `t${Date.now()}`;
  const base = 900_000_000 + Math.floor(Math.random() * 1_000_000) * 10;
  const today = localIsoDate(new Date());
  const past = "2020-01-01";
  const future = "2099-01-01";

  await unscoped("behaviour test — seeds its own clinics", async () => {
    const [a] = await db.insert(clinics).values({ name: `invA${tag}`, modulesEnabled: [] }).returning({ id: clinics.id });
    const [b] = await db.insert(clinics).values({ name: `invB${tag}`, modulesEnabled: [] }).returning({ id: clinics.id });
    try {
      const mk = async (clinicId: string, n: number, amount: number, dueOn: string) => {
        const [r] = await db
          .insert(clinicInvoices)
          .values({ clinicId, invoiceNo: base + n, amount, dueOn, periodStart: "2026-11-01", periodEnd: "2026-12-01" })
          .returning({ id: clinicInvoices.id });
        return r.id;
      };
      const pay = async (clinicId: string, invoiceId: string | null, amount: number, kind: "payment" | "refund" | "credit" = "payment") => {
        const [r] = await db
          .insert(clinicPayments)
          .values({ clinicId, invoiceId, amount, kind, monthsCovered: 0 })
          .returning({ id: clinicPayments.id });
        return r.id;
      };

      const overdue = await mk(a.id, 1, 1000, past); // nothing paid, past due
      const partly = await mk(a.id, 2, 1000, future); // 400 paid
      const paid = await mk(a.id, 3, 1000, past); // 600 + 400 credit = paid
      const refunded = await mk(a.id, 4, 1000, future); // 1000 − 300 refund = 700
      const voidedPay = await mk(a.id, 5, 500, future); // its only payment is voided
      const otherClinic = await mk(b.id, 6, 800, future);

      await pay(a.id, partly, 400);
      await pay(a.id, paid, 600);
      await pay(a.id, paid, 400, "credit");
      await pay(a.id, refunded, 1000);
      await pay(a.id, refunded, 300, "refund");
      const gone = await pay(a.id, voidedPay, 500);
      await db.update(clinicPayments).set({ deletedAt: new Date() }).where(eq(clinicPayments.id, gone));
      const loose = await pay(a.id, null, 250); // recorded before invoices had a status

      console.log("Paid per invoice:");
      const { rows, summary } = await listClinicInvoices({ clinicId: a.id, limit: 50 });
      const by = new Map(rows.map((r) => [r.id, r]));
      ok("unpaid invoice shows 0 paid", by.get(overdue)?.paid === 0);
      ok("partly paid shows 400", by.get(partly)?.paid === 400);
      ok("a credit counts as paid", by.get(paid)?.paid === 1000);
      ok("a refund takes money back off the invoice", by.get(refunded)?.paid === 700);
      ok("a voided payment does not count", by.get(voidedPay)?.paid === 0);
      ok("an unlinked payment pays no invoice", rows.every((r) => r.paid !== 250));
      ok("another clinic's invoice is not listed", !by.has(otherClinic));

      console.log("Status filters agree with the pure rules:");
      const bucket = (f: InvoiceStatusFilter, r: (typeof rows)[number]) => {
        const st = invoiceStatus(r.total, r.paid, r.dueOn, today);
        if (f === "paid") return st.state === "paid";
        if (f === "unpaid") return st.balance > 0;
        if (f === "partly") return st.state === "partly_paid";
        return st.overdue;
      };
      for (const f of ["paid", "unpaid", "partly", "overdue"] as const) {
        const got = (await listClinicInvoices({ clinicId: a.id, status: f, limit: 50 })).rows.map((r) => r.id).sort();
        const want = rows.filter((r) => bucket(f, r)).map((r) => r.id).sort();
        ok(`"${f}" returns the right invoices`, JSON.stringify(got) === JSON.stringify(want), `got ${got.length}, want ${want.length}`);
      }
      ok("overdue holds exactly the past-due unpaid invoice", (await listClinicInvoices({ clinicId: a.id, status: "overdue" })).rows.map((r) => r.id).join() === overdue);

      console.log("Summary:");
      const owed = rows.reduce((s, r) => s + invoiceStatus(r.total, r.paid, r.dueOn, today).balance, 0);
      ok("outstanding is the sum of balances", summary.outstanding === owed, `${summary.outstanding} vs ${owed}`);
      ok("overdue count and amount", summary.overdueCount === 1 && summary.overdueAmount === 1000);
      ok("invoiced is the sum of amounts", summary.invoiced === 4500);

      console.log("Linking:");
      ok("own live invoice is accepted", await isLiveInvoiceOfClinic(overdue, a.id));
      ok("another clinic's invoice is refused", !(await isLiveInvoiceOfClinic(otherClinic, a.id)));
      const cross = await setPaymentInvoice(a.id, loose, otherClinic);
      ok("a payment cannot be linked across clinics", "error" in cross);
      const linked = await setPaymentInvoice(a.id, loose, overdue);
      const after = (await listClinicInvoices({ clinicId: a.id, limit: 50 })).rows.find((r) => r.id === overdue);
      ok("linking an older payment marks the invoice partly paid", "ok" in linked && after?.paid === 250);
      const unlinked = await setPaymentInvoice(a.id, loose, null);
      const after2 = (await listClinicInvoices({ clinicId: a.id, limit: 50 })).rows.find((r) => r.id === overdue);
      ok("unlinking takes it off again", "ok" in unlinked && after2?.paid === 0);

      console.log("Editing:");
      const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Tester" };
      const [{ grace }] = await db.select({ grace: clinics.graceDays }).from(clinics).where(eq(clinics.id, a.id));
      const edited = await updateClinicInvoice(
        partly,
        { amount: 300, tax: null, periodStart: "2026-12-01", periodEnd: "2027-01-01", dueOn: null, note: "  corrected  " },
        actor,
      );
      const row = (await listClinicInvoices({ clinicId: a.id, limit: 50 })).rows.find((r) => r.id === partly);
      ok("the edit is saved", "ok" in edited && row?.amount === 300 && row?.periodStart === "2026-12-01" && row?.note === "corrected");
      ok("the before values are returned for the audit line", "ok" in edited && edited.before.amount === 1000 && edited.after.amount === 300);
      ok("an empty due date is worked out again from the new period", row?.dueOn === localIsoDate(new Date(2026, 11, 1 + (grace ?? 0))));
      ok("payments already linked stay linked", row?.paid === 400);
      const st = row ? invoiceStatus(row.total, row.paid, row.dueOn, today) : null;
      ok("below what was paid → Paid, with the excess shown", st?.state === "paid" && st.overpaid === 100);
      ok("who edited it, and when, is kept", row?.updatedByName === "Tester" && row?.updatedAt instanceof Date);
      const fixedDue = await updateClinicInvoice(partly, { amount: 300, tax: null, periodStart: null, periodEnd: null, dueOn: "2027-02-02", note: null }, actor);
      const row2 = (await listClinicInvoices({ clinicId: a.id, limit: 50 })).rows.find((r) => r.id === partly);
      ok("a typed due date is kept; a cleared period and note save as empty", "ok" in fixedDue && row2?.dueOn === "2027-02-02" && row2.periodStart === null && row2.note === null);
      await db.update(clinicInvoices).set({ deletedAt: new Date() }).where(eq(clinicInvoices.id, refunded));
      const onVoided = await updateClinicInvoice(refunded, { amount: 1, tax: null, periodStart: null, periodEnd: null, dueOn: null, note: null }, actor);
      ok("a voided invoice cannot be edited", "error" in onVoided);

      console.log("Tax:");
      const taxed = await updateClinicInvoice(overdue, { amount: 1000, tax: { label: "Sales tax", rate: 16 }, periodStart: null, periodEnd: null, dueOn: future, note: null }, actor);
      await pay(a.id, overdue, 1000);
      const t = (await listClinicInvoices({ clinicId: a.id, limit: 50 })).rows.find((r) => r.id === overdue);
      ok("tax is stored with its label and rate", "ok" in taxed && t?.taxAmount === 160 && t.taxRate === 16 && t.taxLabel === "Sales tax");
      ok("the clinic owes amount + tax", t?.total === 1160);
      const ts = t ? invoiceStatus(t.total, t.paid, t.dueOn, today) : null;
      ok("paying only the amount leaves the tax owed (Partly paid, Rs 160)", ts?.state === "partly_paid" && ts.balance === 160);
      const partlyIds = (await listClinicInvoices({ clinicId: a.id, status: "partly", limit: 50 })).rows.map((r) => r.id);
      ok("the SQL filter counts the tax too", partlyIds.includes(overdue));
      ok("the audit values name the tax", "ok" in taxed && taxed.before.tax === null && taxed.after.tax === "Sales tax 16%");
      await updateClinicInvoice(overdue, { amount: 1000, tax: null, periodStart: null, periodEnd: null, dueOn: future, note: null }, actor);
      const u = (await listClinicInvoices({ clinicId: a.id, limit: 50 })).rows.find((r) => r.id === overdue);
      ok("unticking tax removes it, and the invoice is paid", u?.taxAmount === 0 && u.taxRate === null && u.total === 1000 && invoiceStatus(u.total, u.paid, u.dueOn, today).state === "paid");
    } finally {
      const ids = [a.id, b.id];
      await db.delete(clinicPayments).where(inArray(clinicPayments.clinicId, ids));
      await db.delete(clinicInvoices).where(inArray(clinicInvoices.clinicId, ids));
      await db.delete(clinics).where(inArray(clinics.id, ids));
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
