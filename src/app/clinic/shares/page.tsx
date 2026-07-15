import { requireWorkspace } from "@/core/auth/user";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getSharesReport } from "@/core/sales/share-report";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { SalesChart } from "@/app/clinic/sales/sales-chart";
import { SalesFilters } from "@/app/clinic/sales/sales-filters";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Revenue-share earnings report (gated by the `shares` permission). Reads the
 * per-doctor `sale_shares` ledger. A DOCTOR sees only their OWN earnings; a clinic
 * admin / granted manager sees every doctor plus the clinic's derived cut. Filter
 * by period, custom range, and (full view) doctor. Clinic-scoped.
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
  // A doctor only ever sees their own earnings (ignore any doctorId param).
  const selfOnly = user.role === "doctor";

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
  const doctorId = selfOnly ? user.id : sp.doctorId?.trim() || null;

  const [report, doctors] = await Promise.all([
    getSharesReport(clinicId, range, doctorId),
    selfOnly ? Promise.resolve([]) : getSalesDoctors(clinicId),
  ]);

  const summary = selfOnly
    ? [
        { title: "Your earnings", value: money.format(report.shareTotal), note: "Your share this period" },
        { title: "Earning visits", value: String(report.count), note: "Visits you earned on" },
        { title: "Avg per visit", value: money.format(report.avgShare), note: "Earnings ÷ visits" },
      ]
    : [
        { title: "Doctor shares", value: money.format(report.shareTotal), note: "Paid out to doctors" },
        {
          title: "Clinic share",
          value: report.clinicTotal !== null ? money.format(report.clinicTotal) : "—",
          note: report.clinicTotal !== null ? "Net minus doctor shares" : "Whole-clinic view only",
        },
        { title: "Earning visits", value: String(report.count), note: "Doctor share rows" },
        { title: "Avg per visit", value: money.format(report.avgShare), note: "Shares ÷ visits" },
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
      <div
        className={
          selfOnly
            ? "grid gap-4 sm:grid-cols-3"
            : "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        }
      >
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
            <CardDescription>Earned share per doctor in this period.</CardDescription>
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
                  </tr>
                </thead>
                <tbody>
                  {report.byDoctor.map((d) => (
                    <tr key={d.doctorId ?? "none"} className="border-b last:border-0">
                      <td className="py-2">{d.name}</td>
                      <td className="py-2 text-right tabular-nums">{d.count}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(d.earned)}</td>
                    </tr>
                  ))}
                  {report.clinicTotal !== null ? (
                    <tr className="border-t font-medium">
                      <td className="py-2">Clinic</td>
                      <td className="py-2 text-right tabular-nums">—</td>
                      <td className="py-2 text-right tabular-nums">
                        {money.format(report.clinicTotal)}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
