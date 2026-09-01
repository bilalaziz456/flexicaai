import { listClinicDoctors } from "@/core/appointments/doctors";
import { getClinic } from "@/core/clinics/get-clinic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/core/auth/user";
import { getDoctorBalance, listPayouts } from "@/core/sales/payouts";
import { listDoctorEarnings, listDoctorSettlements } from "@/core/sales/share-report";
import { listSettlementActions } from "@/core/sales/settlement-actions";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { PrintButton } from "@/core/ui/print-button";
import { SETTLEMENT_LABEL } from "../settlement-ui";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";

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

  // `listClinicDoctors` already formats the display name (prefix + fallback), so the
  // statement header and every doctor picker spell it the same way.
  const [doctor] = await listClinicDoctors(clinicId, { doctorId });
  if (!doctor) redirect("/clinic/shares");

  const clinic = await getClinic(clinicId);

  const [balance, earnings, settlements, actions, payments] = await Promise.all([
    getDoctorBalance(clinicId, doctorId),
    listDoctorEarnings(clinicId, doctorId),
    listDoctorSettlements(clinicId, doctorId),
    listSettlementActions(clinicId, doctorId),
    listPayouts(clinicId, doctorId),
  ]);

  const doctorName = doctor.name; // already formatted by listClinicDoctors
  const backHref = user.role === "doctor" ? "/clinic/shares" : `/clinic/shares?doctorId=${doctorId}`;
  const borneTotal = balance.borne + balance.adjustments; // discount bearing + waives
  const owes = balance.outstanding < 0;

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
      <div className={`grid gap-4 ${borneTotal !== 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {[
          { label: "Earned", value: balance.earned, show: true, tone: "" },
          { label: "Discount adjustment", value: borneTotal, show: borneTotal !== 0, tone: borneTotal < 0 ? "text-destructive" : "text-emerald-600" },
          { label: "Paid", value: balance.paid, show: true, tone: "" },
          { label: owes ? "Owes clinic" : "Outstanding", value: Math.abs(balance.outstanding), show: true, tone: owes ? "text-destructive" : "" },
        ]
          .filter((b) => b.show)
          .map((b) => (
            <div key={b.label} className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className={`text-lg font-semibold tabular-nums ${b.tone}`}>{money.format(b.value)}</p>
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

      {/* Discount adjustment (settlements) */}
      {settlements.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Discount adjustment</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Patient</th>
                  <th className="pb-2 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{fmtDate(s.occurredAt)}</td>
                    <td className="py-1.5">{s.patientName ?? "—"}</td>
                    <td className={`py-1.5 text-right tabular-nums ${s.amount < 0 ? "text-destructive" : ""}`}>
                      {money.format(s.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="py-2" colSpan={2}>Total adjustment</td>
                  <td className="py-2 text-right tabular-nums">{money.format(balance.borne)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Waives & settlements (actions) */}
      {actions.length > 0 ? (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Waives &amp; settlements</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Action</th>
                  <th className="pb-2 font-normal">Note</th>
                  <th className="pb-2 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-1.5">{fmtDate(a.createdAt)}</td>
                    <td className="py-1.5">{SETTLEMENT_LABEL[a.kind] ?? a.kind}</td>
                    <td className="py-1.5">{a.note ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {a.kind === "doctor_waive" ? "−" : "+"}
                      {money.format(a.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

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
                    <td className="py-1.5">{vocabularyLabel("payment_methods", p.method)}</td>
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
        <span>{owes ? "Owed by doctor to the clinic" : "Outstanding balance"}</span>
        <span className={`tabular-nums ${owes ? "text-destructive" : ""}`}>
          {money.format(Math.abs(balance.outstanding))}
        </span>
      </div>

      <div className="border-t pt-4 text-center text-xs text-muted-foreground">
        {BRAND_POWERED_BY}
      </div>
    </div>
  );
}
