import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { getSalesDoctors, resolveSalesRange } from "@/core/sales/report";
import { getPaymentsLedger, isMoneyOut } from "@/core/finance/payments-ledger";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { PaymentsFilters } from "./payments-filters";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

const KIND_LABEL: Record<string, string> = {
  payment: "Payment",
  advance: "Advance",
  advance_applied: "Advance applied",
  refund: "Refund",
};

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

  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
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

  const dayFmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const signed = (r: (typeof ledger.rows)[number]) =>
    `${isMoneyOut(r.kind) ? "−" : ""}${money.format(r.amount)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            Every payment, advance, and refund — money in and out of the clinic.
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
          {ledger.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments in this period.</p>
          ) : (
            <>
              {/* Desktop */}
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-normal">Date</th>
                    <th className="pb-2 font-normal">Patient</th>
                    <th className="pb-2 font-normal">Doctor</th>
                    <th className="pb-2 font-normal">Type</th>
                    <th className="pb-2 font-normal">Method</th>
                    <th className="pb-2 font-normal">By</th>
                    <th className="pb-2 text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2">{dayFmt(r.occurredAt)}</td>
                      <td className="py-2">
                        <Link
                          href={`/clinic/patients/${r.patientId}`}
                          className="underline underline-offset-4"
                        >
                          {r.patientName}
                        </Link>
                      </td>
                      <td className="py-2">{r.doctorName ?? "—"}</td>
                      <td className="py-2">{KIND_LABEL[r.kind] ?? r.kind}</td>
                      <td className="py-2">{r.method ?? "—"}</td>
                      <td className="py-2 text-muted-foreground">{r.createdByName ?? "—"}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{signed(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Mobile */}
              <ul className="space-y-2 md:hidden">
                {ledger.rows.map((r) => (
                  <li key={r.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/clinic/patients/${r.patientId}`}
                        className="font-medium underline underline-offset-4"
                      >
                        {r.patientName}
                      </Link>
                      <span className="font-medium tabular-nums">{signed(r)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{dayFmt(r.occurredAt)}</span>
                      <span>· {KIND_LABEL[r.kind] ?? r.kind}</span>
                      {r.method ? <span>· {r.method}</span> : null}
                      {r.doctorName ? <span>· {r.doctorName}</span> : null}
                      {r.createdByName ? <span>· by {r.createdByName}</span> : null}
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
