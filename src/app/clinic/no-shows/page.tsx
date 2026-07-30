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
import { SalesFilters } from "@/app/clinic/sales/sales-filters";
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
          <CardDescription>No-show rate per doctor (worst first).</CardDescription>
        </CardHeader>
        <CardContent>
          <NoShowsTable rows={stats.byDoctor} />
        </CardContent>
      </Card>
    </div>
  );
}
