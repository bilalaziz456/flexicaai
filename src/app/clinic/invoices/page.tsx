import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Download, Printer } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { resolveSalesRange } from "@/core/sales/report";
import { getInvoicesList } from "@/core/billing/invoice";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { InvoiceFilters } from "./invoice-filters";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});
const dayFmt = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Invoice register (Finance) — every issued invoice, newest number first, for lookup
 * and reprint (search by number or patient). The invoice number links to its
 * printable page. Gated by the `sales` feature + the `billing` permission; reached
 * from the Reports hub (no separate nav item). Clinic-scoped.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; q?: string }>;
}) {
  const { clinicId } = await requireWorkspace("billing");
  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const hasRange = Boolean(sp.period) && sp.period !== "all";
  const range = hasRange ? resolveSalesRange(sp.period, sp.from, sp.to) : null;
  const q = sp.q?.trim() || "";

  const list = await getInvoicesList(clinicId, {
    from: range?.start,
    toExclusive: range?.end,
    q: q || undefined,
  });

  const exportParams = new URLSearchParams({ type: "invoices" });
  if (hasRange && range) {
    exportParams.set("period", range.period);
    if (range.period === "custom") {
      exportParams.set("from", range.from);
      exportParams.set("to", range.to);
    }
  }
  if (q) exportParams.set("q", q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            The numbered invoice register — search by number or patient, and reprint any invoice.
          </p>
        </div>
        {list.rows.length > 0 ? (
          <a
            href={`/api/finance/export?${exportParams.toString()}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-accent"
          >
            <Download className="size-3.5" aria-hidden="true" /> CSV
          </a>
        ) : null}
      </div>

      <InvoiceFilters period={range?.period ?? "all"} from={range?.from ?? ""} to={range?.to ?? ""} q={q} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardDescription>Invoices</CardDescription>
            <CardTitle className="text-3xl">{list.count}</CardTitle>
            <CardDescription>Issued in this view</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total billed</CardDescription>
            <CardTitle className="text-3xl">{money.format(list.totalBilled)}</CardTitle>
            <CardDescription>Sum of these invoices</CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register</CardTitle>
        </CardHeader>
        <CardContent>
          {list.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {q ? "No invoices match your search." : "No invoices issued yet."}
            </p>
          ) : (
            <>
              {/* Desktop */}
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Invoice</th>
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Patient</th>
                    <th className="pb-2 font-normal">Issued by</th>
                    <th className="pb-2 text-right font-normal">Amount</th>
                    <th className="pb-2 text-right font-normal">Print</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.label}</td>
                      <td className="py-2">{dayFmt(r.issuedAt)}</td>
                      <td className="py-2">
                        <Link href={`/clinic/patients/${r.patientId}`} className="underline underline-offset-4">
                          {r.patientName}
                        </Link>
                      </td>
                      <td className="py-2 text-muted-foreground">{r.issuedByName ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums">{money.format(r.amount)}</td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/clinic/appointments/${r.appointmentId}/invoice`}
                          className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        >
                          <Printer className="size-3.5" aria-hidden="true" /> Print
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Mobile */}
              <ul className="space-y-2 md:hidden">
                {list.rows.map((r) => (
                  <li key={r.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.label}</span>
                      <span className="font-medium tabular-nums">{money.format(r.amount)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Link href={`/clinic/patients/${r.patientId}`} className="underline underline-offset-4">
                        {r.patientName}
                      </Link>
                      <span>· {dayFmt(r.issuedAt)}</span>
                      {r.issuedByName ? <span>· {r.issuedByName}</span> : null}
                    </div>
                    <Link
                      href={`/clinic/appointments/${r.appointmentId}/invoice`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4"
                    >
                      <Printer className="size-3.5" aria-hidden="true" /> Print invoice
                    </Link>
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
