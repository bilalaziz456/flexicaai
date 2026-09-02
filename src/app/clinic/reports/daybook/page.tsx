import Link from "next/link";
import { getClinic } from "@/core/clinics/get-clinic";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth/user";
import { clinicHasFeature } from "@/core/lib/features";
import { getDayBook } from "@/core/finance/daybook";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { PrintButton } from "@/core/ui/print-button";
import { BRAND_POWERED_BY } from "@/core/lib/brand";
import { DayBookControls } from "./daybook-controls";
import { DaybookTable } from "./daybook-table";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});
const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

// Printing is how this app makes PDFs (no PDF library — CLAUDE.md §12). Drop the panel
// chrome and the controls so the sheet prints as a standalone record.
const PRINT_CSS = `
@media print {
  aside, header, .no-print { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
}`;

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Day book (Finance) — a day's cash movement by method for end-of-day
 * reconciliation. Gated by the sales feature + billing:view (front-desk work).
 */
export default async function DayBookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireWorkspace("billing");
  const { clinicId } = user;
  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "sales")) notFound();

  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayStr();
  const book = await getDayBook(clinicId, date);

  return (
    <div className="space-y-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Day book</h1>
          {/* On screen: what the page is. On paper: WHICH day and WHOSE clinic —
              a printed cash sheet with no date or clinic name is not a record. */}
          <p className="text-sm text-muted-foreground no-print">The day&apos;s cash in and out, by method.</p>
          <p className="hidden text-sm text-muted-foreground print:block">
            {clinic?.name ?? "Clinic"} · {fmtDay(date)}
          </p>
        </div>
        <div className="no-print flex items-end gap-3">
          <DayBookControls date={date} />
          <a
            href={`/api/finance/export?type=daybook&date=${date}`}
            className="h-8 rounded-lg border border-input bg-[var(--input-bg)] px-4 text-sm font-medium leading-8 outline-none transition-colors hover:bg-accent"
          >
            Export CSV
          </a>
          <PrintButton label="Download PDF" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {[
          { title: "Collected", value: money.format(book.totals.collected) },
          { title: "Refunded", value: money.format(book.totals.refunded) },
          { title: "Expenses", value: money.format(book.totals.expenses) },
          { title: "Doctor payouts", value: money.format(book.totals.payouts) },
          { title: "Net cash", value: money.format(book.totals.net), tone: book.totals.net < 0 ? "text-destructive" : "" },
        ].map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardDescription>{c.title}</CardDescription>
              <CardTitle className={`text-2xl ${c.tone ?? ""}`}>{c.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By method</CardTitle>
        </CardHeader>
        <CardContent>
          <DaybookTable rows={book.rows} />
        </CardContent>
      </Card>

      <p className="no-print text-sm text-muted-foreground">
        <Link href="/clinic/reports" className="underline underline-offset-4">← All reports</Link>
      </p>

      <p className="hidden text-center text-xs text-muted-foreground print:block">{BRAND_POWERED_BY}</p>
    </div>
  );
}
