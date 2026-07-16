import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getDiscountsReport } from "@/core/sales/discounts-report";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { Badge } from "@/core/ui/badge";
import { DiscountFilters } from "./discounts-filters";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});
const BORNE: Record<string, string> = { clinic: "Clinic", doctor: "Doctor", split: "Split" };
const STATUS: Record<string, { label: string; variant: "outline" | "secondary" | "destructive" }> = {
  none: { label: "Applied", variant: "outline" },
  approved: { label: "Approved", variant: "outline" },
  pending: { label: "Pending", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
};

/**
 * Discounts report — every discount given: patient, doctor, amount, who bears it,
 * approval status. Gated by the `discounts` permission + the sales feature.
 */
export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    doctorId?: string;
    borneBy?: string;
    status?: string;
  }>;
}) {
  const user = await requireWorkspace("discounts");
  const { clinicId } = user;

  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
  const doctorId = sp.doctorId?.trim() || null;
  const borneBy = sp.borneBy?.trim() || "";
  const status = sp.status?.trim() || "";

  const [report, doctors] = await Promise.all([
    getDiscountsReport(clinicId, range, { doctorId, borneBy, status }),
    getSalesDoctors(clinicId),
  ]);

  const dayFmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const discLabel = (r: (typeof report.rows)[number]) =>
    r.type === "percent" ? `${money.format(r.amount)} (${r.value}%)` : money.format(r.amount);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Discounts</h1>
        <p className="text-sm text-muted-foreground">
          Every discount given — who got it, who bears it, and whether it&apos;s applied.
        </p>
      </div>

      <DiscountFilters
        period={range.period}
        from={range.from}
        to={range.to}
        doctorId={doctorId ?? ""}
        borneBy={borneBy}
        status={status}
        doctors={doctors}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Applied", value: money.format(report.totalApplied), note: "Discounts in effect" },
          { title: "Pending approval", value: money.format(report.totalPending), note: "Not applied yet" },
          { title: "Count", value: String(report.count), note: "Discounted visits" },
        ].map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <CardDescription>{s.title}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
              <CardDescription>{s.note}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discounts</CardTitle>
        </CardHeader>
        <CardContent>
          {report.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No discounts in this period.</p>
          ) : (
            <>
              {/* Desktop */}
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Patient</th>
                    <th className="pb-2 font-normal">Doctor</th>
                    <th className="pb-2 font-normal">Borne by</th>
                    <th className="pb-2 font-normal">Status</th>
                    <th className="pb-2 text-right font-normal">Discount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.appointmentId} className="border-b last:border-0">
                      <td className="py-2">
                        <Link href={`/clinic/appointments/${r.appointmentId}`} className="underline underline-offset-4">
                          {dayFmt(r.scheduledAt)}
                        </Link>
                      </td>
                      <td className="py-2">{r.patientName ?? "—"}</td>
                      <td className="py-2">{r.doctorName ?? "—"}</td>
                      <td className="py-2">
                        {BORNE[r.borneBy] ?? "Clinic"}
                        {r.borneBy !== "clinic" ? (
                          <span className="block text-xs text-muted-foreground">
                            Clinic {money.format(r.clinicBears)} · Dr {money.format(r.doctorBears)}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2">
                        <Badge variant={STATUS[r.status]?.variant ?? "outline"}>
                          {STATUS[r.status]?.label ?? r.status}
                        </Badge>
                        {r.approvedBy ? (
                          <span className="block text-xs text-muted-foreground">by {r.approvedBy}</span>
                        ) : null}
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">{discLabel(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Mobile */}
              <ul className="space-y-2 md:hidden">
                {report.rows.map((r) => (
                  <li key={r.appointmentId} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/clinic/appointments/${r.appointmentId}`} className="font-medium underline underline-offset-4">
                        {r.patientName ?? "—"}
                      </Link>
                      <span className="font-medium tabular-nums">{discLabel(r)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{dayFmt(r.scheduledAt)}</span>
                      {r.doctorName ? <span>· {r.doctorName}</span> : null}
                      <span>· borne by {BORNE[r.borneBy] ?? "Clinic"}</span>
                      {r.borneBy !== "clinic" ? (
                        <span>· Clinic {money.format(r.clinicBears)} / Dr {money.format(r.doctorBears)}</span>
                      ) : null}
                      <Badge variant={STATUS[r.status]?.variant ?? "outline"}>
                        {STATUS[r.status]?.label ?? r.status}
                      </Badge>
                      {r.approvedBy ? <span>· by {r.approvedBy}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
