import { requireWorkspace } from "@/core/auth/user";
import { getClinic } from "@/core/clinics/get-clinic";
import { resolveSalesRange } from "@/core/sales/report";
import { getNoShowStats } from "@/core/appointments/no-shows";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { SalesFilters } from "@/core/ui/report-filters";
import { ScatterPlot } from "@/core/ui/charts/scatter-plot";
import { NoShowsTable } from "./no-shows-table";

/**
 * No-show report (operations) — the share of intended appointments the patient
 * didn't attend, over a period, with a per-doctor breakdown. Available to any clinic
 * (not finance-gated); requires `appointments:view`.
 */
export default async function NoShowsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireWorkspace("appointments");
  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to, (await getClinic(user.clinicId))?.createdAt);
  const stats = await getNoShowStats(user.clinicId, range);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const cards = [
    { title: "No-show rate", value: pct(stats.rate), note: `${stats.noShow} of ${stats.attended} intended visits`, big: true },
    { title: "No-shows", value: String(stats.noShow), note: "Patient didn't attend" },
    { title: "Completed", value: String(stats.completed), note: "Attended visits" },
    { title: "Cancelled", value: String(stats.cancelled), note: "Called off (not counted in the rate)" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">No-shows</h1>
        <p className="text-sm text-muted-foreground">
          Share of intended appointments (completed + no-show) the patient didn&apos;t attend.
        </p>
      </div>

      <SalesFilters period={range.period} from={range.from} to={range.to} doctorId="" doctors={[]} showDoctor={false} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardDescription>{c.title}</CardDescription>
              <CardTitle className={c.big ? "text-4xl" : "text-3xl"}>{c.value}</CardTitle>
              <CardDescription>{c.note}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By doctor</CardTitle>
          <CardDescription>
            No-show rate against how many visits each doctor was booked for. Above the
            line is worse than the clinic overall.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* A SCATTER, because the question here is a relationship: a 40% no-show
              rate on five visits and the same rate on two hundred are different
              problems, and a ranked list of rates puts them side by side as equals.
              Volume runs across, rate runs up, and the clinic's own rate is the line
              — so "who is worse than us as a whole" is a position, not a subtraction.
              The table keeps the exact figures underneath. */}
          {stats.byDoctor.length > 1 ? (
            <ScatterPlot
              ariaLabel="No-show rate against booked visits, by doctor"
              xLabel="Visits booked"
              yLabel="No-show rate"
              height={240}
              goodSide="below"
              refLine={{ value: stats.rate * 100, label: "Clinic average" }}
              xFormat="count"
              yFormat="percent"
              points={stats.byDoctor.map((d) => ({
                label: d.name,
                x: d.attended,
                y: d.rate * 100,
                weight: d.noShow,
              }))}
            />
          ) : null}
          <div className="mt-5">
            <NoShowsTable rows={stats.byDoctor} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
