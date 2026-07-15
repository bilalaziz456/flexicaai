import Link from "next/link";
import { requireWorkspace } from "@/core/auth/user";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getSharesReport } from "@/core/sales/share-report";
import { getDoctorBalances, listPayouts } from "@/core/sales/payouts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { SalesChart } from "@/app/clinic/sales/sales-chart";
import { SalesFilters } from "@/app/clinic/sales/sales-filters";
import { RecordPayoutForm, VoidPayoutButton } from "./payout-ui";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Revenue-share earnings + payments. Balances (Earned / Paid / Outstanding) are
 * LIFETIME and amount-based; the period filter scopes only the earnings-over-time
 * chart. A DOCTOR sees only their own; a clinic admin sees every doctor and can
 * record an arbitrary (partial) payment against a doctor's outstanding balance.
 */
export default async function ClinicSharesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; doctorId?: string }>;
}) {
  const user = await requireWorkspace("shares");
  const { clinicId } = user;
  const selfOnly = user.role === "doctor";
  const isAdmin = user.role === "clinic_admin";

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
  const doctorId = selfOnly ? user.id : sp.doctorId?.trim() || null;
  const singleDoctor = selfOnly || Boolean(doctorId);

  const [balances, report, payouts, doctors] = await Promise.all([
    getDoctorBalances(clinicId, doctorId),
    getSharesReport(clinicId, range, doctorId),
    listPayouts(clinicId, doctorId),
    selfOnly ? Promise.resolve([]) : getSalesDoctors(clinicId),
  ]);

  // Balance figures: one doctor when scoped, else clinic-wide totals.
  const scoped = singleDoctor
    ? (balances[0] ?? { earned: 0, paid: 0, outstanding: 0 })
    : {
        earned: balances.reduce((s, b) => s + b.earned, 0),
        paid: balances.reduce((s, b) => s + b.paid, 0),
        outstanding: balances.reduce((s, b) => s + b.outstanding, 0),
      };

  const summary = [
    { title: "Earned", value: money.format(scoped.earned), note: selfOnly ? "Your lifetime share" : "Doctor shares, all time" },
    { title: "Paid", value: money.format(scoped.paid), note: "Settled to date" },
    { title: "Outstanding", value: money.format(scoped.outstanding), note: "Still owed" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Revenue shares</h1>
          <p className="text-sm text-muted-foreground">
            {selfOnly
              ? "Your share of completed visits, and what's been paid."
              : "What each doctor has earned from completed visits, and what's owed."}
          </p>
        </div>
        {singleDoctor ? (
          <Link
            href={selfOnly ? "/clinic/shares/statement" : `/clinic/shares/statement?doctorId=${doctorId}`}
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            View statement
          </Link>
        ) : null}
      </div>

      {/* Balance (lifetime) */}
      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardDescription>{s.title}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
              <CardDescription>{s.note}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Record a payment — clinic admin, scoped to one doctor with a balance. */}
      {isAdmin && doctorId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record payment</CardTitle>
            <CardDescription>
              Pay any amount against this doctor&apos;s outstanding balance (partial
              is fine).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scoped.outstanding > 0 ? (
              <RecordPayoutForm doctorId={doctorId} outstanding={scoped.outstanding} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding for this doctor.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Per-doctor balances (full, unscoped view) — click a doctor to pay them. */}
      {!singleDoctor ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By doctor</CardTitle>
            <CardDescription>Lifetime earned, paid and outstanding.</CardDescription>
          </CardHeader>
          <CardContent>
            {balances.length === 0 ? (
              <p className="text-sm text-muted-foreground">No doctor shares yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Doctor</th>
                    <th className="pb-2 text-right font-normal">Earned</th>
                    <th className="pb-2 text-right font-normal">Paid</th>
                    <th className="pb-2 text-right font-normal">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.doctorId} className="border-b last:border-0">
                      <td className="py-2">
                        <Link
                          href={`/clinic/shares?doctorId=${b.doctorId}`}
                          className="underline underline-offset-4 hover:text-foreground"
                        >
                          {b.name}
                        </Link>
                      </td>
                      <td className="py-2 text-right tabular-nums">{money.format(b.earned)}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(b.paid)}</td>
                      <td className="py-2 text-right font-medium tabular-nums">
                        {money.format(b.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Earnings over time (period-filtered analysis) */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Earnings over time</CardTitle>
              <CardDescription>
                {money.format(report.shareTotal)} earned in the selected period.
                {doctorId ? (
                  <>
                    {" "}
                    <Link href="/clinic/shares" className="underline underline-offset-4">
                      Show all doctors
                    </Link>
                  </>
                ) : null}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <SalesFilters
            period={range.period}
            from={range.from}
            to={range.to}
            doctorId={selfOnly ? "" : (doctorId ?? "")}
            doctors={doctors}
            showDoctor={!selfOnly}
          />
          {report.count === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No earnings in this period.
            </p>
          ) : (
            <SalesChart
              points={report.buckets}
              ariaLabel={selfOnly ? "Your earnings over time" : "Doctor shares over time"}
            />
          )}
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
          <CardDescription>
            {singleDoctor ? "Recorded payments." : "Recent payments across doctors."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Date</th>
                    {!singleDoctor ? <th className="pb-2 font-normal">Doctor</th> : null}
                    <th className="pb-2 font-normal">Method</th>
                    <th className="pb-2 text-right font-normal">Amount</th>
                    {isAdmin ? <th className="pb-2 text-right font-normal" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id} className="border-b align-top last:border-0">
                      <td className="py-2">
                        {p.createdAt.toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                        {p.createdByName ? (
                          <span className="block text-xs text-muted-foreground">
                            by {p.createdByName}
                          </span>
                        ) : null}
                      </td>
                      {!singleDoctor ? <td className="py-2">{p.doctorName ?? "—"}</td> : null}
                      <td className="py-2 capitalize">
                        {p.method ?? "—"}
                        {p.reference ? (
                          <span className="block text-xs text-muted-foreground">{p.reference}</span>
                        ) : null}
                        {p.note ? <span className="block text-xs">{p.note}</span> : null}
                      </td>
                      <td className="py-2 text-right tabular-nums">{money.format(p.amount)}</td>
                      {isAdmin ? (
                        <td className="py-2 text-right">
                          <VoidPayoutButton payoutId={p.id} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
