"use client";

import { ClipboardList } from "lucide-react";
import type { ProcedureReport } from "@/core/appointments/procedure-report";
import { formatPkr } from "@/core/appointments/fee";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { StatCard } from "@/core/ui/charts/stat-card";
import { TrendChart } from "@/core/ui/charts/trend-chart";
import { LollipopChart } from "@/core/ui/charts/lollipop-chart";
import { TableCard } from "@/core/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/core/ui/table";
import { EmptyState } from "@/core/ui/empty-state";

const count = (v: number) => new Intl.NumberFormat("en-PK").format(v);

/**
 * The procedures report body — a client component for the same reason as the
 * appointments one: the charts take count formatters. Data from
 * `core/appointments/procedure-report.ts`.
 */
export function ProcedureReportView({
  report: r,
  rangeLabel,
  scopeLabel,
}: {
  report: ProcedureReport;
  rangeLabel: string;
  scopeLabel: string;
}) {
  if (r.totals.times === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={ClipboardList}
            title="No procedures for these filters"
            description={`No ${scopeLabel.toLowerCase()} procedures ${rangeLabel}. Widen the period or change a filter.`}
          />
        </CardContent>
      </Card>
    );
  }
  const t = r.totals;
  const trend = r.buckets.map((b) => b.value);
  const trendLabels = r.buckets.map((b) => b.label);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Procedures" value={count(t.qty)} hint={`${count(t.times)} on visits · ${scopeLabel.toLowerCase()}`} trend={trend} trendLabels={trendLabels} />
        <StatCard label="Different procedures" value={count(t.distinct)} />
        <StatCard label="Patients" value={count(t.patients)} hint="Who had at least one" />
        <StatCard label="Billed" value={formatPkr(t.gross)} hint="Price × quantity" />
        <StatCard label="Clinic offers" value={formatPkr(t.offers)} hint={t.gross ? `${((t.offers / t.gross) * 100).toFixed(1)}% of billed` : undefined} />
        <StatCard label="Net" value={formatPkr(t.net)} hint="After offers, before patient discounts" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Procedures over time</CardTitle>
          <CardDescription>Quantity done, by the visit&apos;s date.</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart points={r.buckets} formatValue={count} valueLabel="Procedures" ariaLabel="Procedures over time" />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Most done</CardTitle>
            <CardDescription>By quantity.</CardDescription>
          </CardHeader>
          <CardContent>
            <LollipopChart
              rows={r.byProcedure.slice(0, 10).map((p) => ({ label: p.name, value: p.qty }))}
              formatValue={count}
              showShare
              ariaLabel="Procedures by quantity"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Most billed</CardTitle>
            <CardDescription>Net, after clinic offers.</CardDescription>
          </CardHeader>
          <CardContent>
            <LollipopChart
              rows={[...r.byProcedure]
                .sort((a, b) => b.net - a.net)
                .slice(0, 10)
                .map((p) => ({ label: p.name, value: p.net }))}
              showShare
              ariaLabel="Procedures by net billed"
            />
          </CardContent>
        </Card>
      </div>

      <TableCard title="By procedure">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead className="text-right">Times</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Patients</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">Offers</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Avg per unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.byProcedure.map((p) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-right tabular-nums">{count(p.times)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(p.qty)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(p.patients)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPkr(p.gross)}</TableCell>
                <TableCell className="text-right tabular-nums">{p.offers > 0 ? `−${formatPkr(p.offers)}` : "—"}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatPkr(p.net)}</TableCell>
                <TableCell className="text-right tabular-nums">{p.qty ? formatPkr(Math.round(p.net / p.qty)) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <TableCard title="By doctor">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Doctor who performed it</TableHead>
              <TableHead className="text-right">Procedures</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.byDoctor.map((d) => (
              <TableRow key={d.doctorId ?? "none"}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="text-right tabular-nums">{count(d.qty)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPkr(d.net)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
