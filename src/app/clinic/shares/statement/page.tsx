import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { byClinic, notDeleted } from "@/core/db/tenant";
import { clinics, users } from "@/core/db/schema";
import { getDoctorBalance, listPayouts } from "@/core/sales/payouts";
import { listDoctorEarnings } from "@/core/sales/share-report";
import { displayStaffName } from "@/core/types/auth";
import { PrintButton } from "../payout-ui";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

// Print CSS: drop the panel chrome so the statement prints clean on its own page.
const PRINT_CSS = `
@media print {
  aside, header { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  .no-print { display: none !important; }
}`;

/**
 * A doctor's printable revenue-share statement — their earning visits, the payments
 * made, and the running balance. A doctor can print their own; a clinic admin /
 * manager can print any doctor's (via ?doctorId=). Print-to-PDF friendly.
 */
export default async function ShareStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ doctorId?: string }>;
}) {
  const user = await requireWorkspace("shares");
  const { clinicId } = user;
  const sp = await searchParams;
  const doctorId = user.role === "doctor" ? user.id : sp.doctorId?.trim();
  if (!doctorId) redirect("/clinic/shares");

  const [doctor] = await db
    .select({ prefix: users.prefix, fullName: users.fullName, username: users.username })
    .from(users)
    .where(byClinic(users.clinicId, clinicId, notDeleted(users.deletedAt), eq(users.id, doctorId)))
    .limit(1);
  if (!doctor) redirect("/clinic/shares");

  const [clinic] = await db
    .select({ name: clinics.name })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  const [balance, earnings, payments] = await Promise.all([
    getDoctorBalance(clinicId, doctorId),
    listDoctorEarnings(clinicId, doctorId),
    listPayouts(clinicId, doctorId),
  ]);

  const doctorName = displayStaffName(doctor.prefix, doctor.fullName, doctor.username);
  const backHref = user.role === "doctor" ? "/clinic/shares" : `/clinic/shares?doctorId=${doctorId}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print flex items-center justify-between">
        <Link href={backHref} className="text-sm text-muted-foreground underline underline-offset-4">
          ← Back
        </Link>
        <PrintButton />
      </div>

      {/* Statement header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold">Revenue share statement</h1>
          <p className="text-sm text-muted-foreground">{doctorName}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">{clinic?.name ?? "Clinic"}</p>
          <p className="text-muted-foreground">Generated {fmtDate(new Date())}</p>
        </div>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Earned", value: balance.earned },
          { label: "Paid", value: balance.paid },
          { label: "Outstanding", value: balance.outstanding },
        ].map((b) => (
          <div key={b.label} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{b.label}</p>
            <p className="text-lg font-semibold tabular-nums">{money.format(b.value)}</p>
          </div>
        ))}
      </div>

      {/* Earning visits */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Earning visits</h2>
        {earnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No earnings yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Patient</th>
                  <th className="pb-2 text-right font-normal">Share</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((e, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{fmtDate(e.occurredAt)}</td>
                    <td className="py-1.5">{e.patientName ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{money.format(e.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="py-2" colSpan={2}>
                    Total earned
                  </td>
                  <td className="py-2 text-right tabular-nums">{money.format(balance.earned)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payments */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Payments received</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Method</th>
                  <th className="pb-2 font-normal">Reference</th>
                  <th className="pb-2 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-1.5">{fmtDate(p.createdAt)}</td>
                    <td className="py-1.5 capitalize">{p.method ?? "—"}</td>
                    <td className="py-1.5">{p.reference ?? p.note ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{money.format(p.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="py-2" colSpan={3}>
                    Total paid
                  </td>
                  <td className="py-2 text-right tabular-nums">{money.format(balance.paid)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Outstanding */}
      <div className="flex items-center justify-between border-t pt-4 text-base font-semibold">
        <span>Outstanding balance</span>
        <span className="tabular-nums">{money.format(balance.outstanding)}</span>
      </div>
    </div>
  );
}
