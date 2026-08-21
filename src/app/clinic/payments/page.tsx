import { notFound } from "next/navigation";
import { getClinic } from "@/core/clinics/get-clinic";

import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getPaymentsLedger } from "@/core/finance/payments-ledger";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { PaymentsFilters } from "./payments-filters";
import { PaymentsTable } from "./payments-table";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Payments ledger (Finance) — the clinic-wide money in/out register, filterable by
 * period, doctor, method, type, and patient. Read-only (void/refund live on the
 * appointment detail). Gated by the `billing` permission + the sales feature; CSV
 * export mirrors the on-screen filters.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    doctorId?: string;
    method?: string;
    kind?: string;
    q?: string;
  }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt);
  const doctorId = sp.doctorId?.trim() || "";
  const method = sp.method?.trim() || "";
  const kind = sp.kind?.trim() || "";
  const q = sp.q?.trim() || "";

  const [ledger, doctors] = await Promise.all([
    getPaymentsLedger(clinicId, {
      from: range.start,
      toExclusive: range.end,
      doctorId: doctorId || undefined,
      method: method || undefined,
      kind: kind || undefined,
      q: q || undefined,
      limit: 500,
    }),
    getSalesDoctors(clinicId),
  ]);

  const exportParams = new URLSearchParams({ type: "payments", period: range.period });
  if (range.period === "custom") {
    exportParams.set("from", range.from);
    exportParams.set("to", range.to);
  }
  if (doctorId) exportParams.set("doctorId", doctorId);
  if (method) exportParams.set("method", method);
  if (kind) exportParams.set("kind", kind);
  if (q) exportParams.set("q", q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Every payment, advance, and refund. Money in and out of the clinic.
          </p>
        </div>
        <a
          href={`/api/finance/export?${exportParams.toString()}`}
          className="inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium hover:bg-accent"
        >
          Export CSV
        </a>
      </div>

      <PaymentsFilters
        period={range.period}
        from={range.from}
        to={range.to}
        doctorId={doctorId}
        method={method}
        kind={kind}
        q={q}
        doctors={doctors}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Money in", value: money.format(ledger.totals.in), note: "Payments + advances" },
          { title: "Refunds", value: money.format(ledger.totals.out), note: "Money returned" },
          { title: "Net", value: money.format(ledger.totals.net), note: "In − refunds" },
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
          <CardTitle className="text-base">
            {ledger.total} payment{ledger.total === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentsTable rows={ledger.rows} empty="No payments in this period." />
        </CardContent>
      </Card>
    </div>
  );
}
