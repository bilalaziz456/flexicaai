import { requireWorkspace } from "@/core/auth/user";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getSharesReport } from "@/core/sales/share-report";
import { listPayouts } from "@/core/sales/payouts";
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
 * Revenue-share earnings + payouts (gated by the `shares` permission). Reads the
 * per-doctor `sale_shares` ledger. A DOCTOR sees only their OWN earnings; a clinic
 * admin / granted manager sees every doctor plus the clinic's derived cut. A clinic
 * admin can also record a payout that settles a doctor's outstanding shares for the
 * filtered period. Clinic-scoped.
 */
export default async function ClinicSharesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    doctorId?: string;
  }>;
}) {
  const user = await requireWorkspace("shares");
  const { clinicId } = user;
  const selfOnly = user.role === "doctor";
  const isAdmin = user.role === "clinic_admin";

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
  const doctorId = selfOnly ? user.id : sp.doctorId?.trim() || null;

  const [report, doctors, payouts] = await Promise.all([
    getSharesReport(clinicId, range, doctorId),
    selfOnly ? Promise.resolve([]) : getSalesDoctors(clinicId),
    listPayouts(clinicId, doctorId),
  ]);

  // A single doctor is in view (self, or an admin filtered to one) → payouts can be
  // recorded for them, and Earned/Paid/Outstanding read as one person's balance.
  const singleDoctor = selfOnly || Boolean(doctorId);

  const summary = selfOnly
    ? [
        { title: "Earned", value: money.format(report.shareTotal), note: "Your share this period" },
        { title: "Paid", value: money.format(report.paidTotal), note: "Already settled" },
        { title: "Outstanding", value: money.format(report.outstandingTotal), note: "Awaiting payout" },
        { title: "Earning visits", value: String(report.count), note: "Visits you earned on" },
      ]
    : [
        { title: "Doctor shares", value: money.format(report.shareTotal), note: "Earned by doctors" },
        {
          title: "Clinic share",
          value: report.clinicTotal !== null ? money.format(report.clinicTotal) : "—",
          note: report.clinicTotal !== null ? "Net minus doctor shares" : "Whole-clinic view only",
        },
        { title: "Outstanding", value: money.format(report.outstandingTotal), note: "Unpaid to doctors" },
        { title: "Earning visits", value: String(report.count), note: "Doctor share rows" },
      ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Revenue shares</h1>
        <p className="text-sm text-muted-foreground">
          {selfOnly
            ? "Your share of completed visits — consultation and procedures."
            : "How each completed visit's revenue splits between doctors and the clinic."}
        </p>
      </div>

      <SalesFilters
        period={range.period}
        from={range.from}
        to={range.to}
        doctorId={selfOnly ? "" : (doctorId ?? "")}
        doctors={doctors}
        showDoctor={!selfOnly}
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      {/* Record a payout — clinic admin, when scoped to one doctor with a balance. */}
      {isAdmin && doctorId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record payout</CardTitle>
            <CardDescription>
              Settle this doctor&apos;s outstanding shares for the selected period
              ({range.from} → {range.to}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {report.outstandingTotal > 0 ? (
              <RecordPayoutForm
                doctorId={doctorId}
                outstanding={report.outstandingTotal}
                period={range.period}
                from={range.from}
                to={range.to}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding for this doctor in this period.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Shares over time */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selfOnly ? "Your earnings over time" : "Doctor shares over time"}
          </CardTitle>
          <CardDescription>
            {report.granularity === "hour"
              ? "By hour"
              : report.granularity === "day"
                ? "By day"
                : report.granularity === "week"
                  ? "By week"
                  : "By month"}
          </CardDescription>
        </CardHeader>
        <CardContent>
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

      {/* Per-doctor breakdown (full view only) */}
      {!selfOnly ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By doctor</CardTitle>
            <CardDescription>Earned, paid and outstanding per doctor.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.byDoctor.length === 0 ? (
              <p className="text-sm text-muted-foreground">No doctor shares yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Doctor</th>
                    <th className="pb-2 text-right font-normal">Visits</th>
                    <th className="pb-2 text-right font-normal">Earned</th>
                    <th className="pb-2 text-right font-normal">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byDoctor.map((d) => (
                    <tr key={d.doctorId ?? "none"} className="border-b last:border-0">
                      <td className="py-2">{d.name}</td>
                      <td className="py-2 text-right tabular-nums">{d.count}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(d.earned)}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(d.outstanding)}</td>
                    </tr>
                  ))}
                  {report.clinicTotal !== null ? (
                    <tr className="border-t font-medium">
                      <td className="py-2">Clinic</td>
                      <td className="py-2 text-right tabular-nums">—</td>
                      <td className="py-2 text-right tabular-nums">
                        {money.format(report.clinicTotal)}
                      </td>
                      <td className="py-2 text-right tabular-nums">—</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Payout history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payouts</CardTitle>
          <CardDescription>
            {singleDoctor ? "Recorded settlements." : "Recent settlements across doctors."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payouts recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Date</th>
                  {!singleDoctor ? <th className="pb-2 font-normal">Doctor</th> : null}
                  <th className="pb-2 font-normal">Period</th>
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
                    <td className="py-2 text-muted-foreground">
                      {p.periodStart && p.periodEnd ? `${p.periodStart} → ${p.periodEnd}` : "—"}
                      {p.note ? (
                        <span className="block text-xs">{p.note}</span>
                      ) : null}
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
