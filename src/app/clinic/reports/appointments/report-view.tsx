"use client";

import type { AppointmentReport } from "@/core/appointments/report";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { StatCard } from "@/core/ui/charts/stat-card";
import { TrendChart } from "@/core/ui/charts/trend-chart";
import { DonutChart } from "@/core/ui/charts/donut-chart";
import { LollipopChart } from "@/core/ui/charts/lollipop-chart";
import { TableCard } from "@/core/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/core/ui/table";
import { EmptyState } from "@/core/ui/empty-state";
import { labelFrom, useVocabulary } from "@/core/ui/vocabulary-provider";
import { CalendarSearch } from "lucide-react";

const count = (v: number) => new Intl.NumberFormat("en-PK").format(v);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// Monday-first, like the appointments calendar.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric", hour12: true });

/**
 * The appointments report body. A CLIENT component only because the charts take a
 * number formatter — these are counts, not rupees — and a function cannot cross from
 * a server page. All data arrives computed (`core/appointments/report.ts`).
 */
export function AppointmentReportView({ report: r, rangeLabel }: { report: AppointmentReport; rangeLabel: string }) {
  const statuses = useVocabulary("appointment_statuses");
  const sources = useVocabulary("appointment_sources");

  if (r.total === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={CalendarSearch}
            title="No appointments for these filters"
            description={`Nothing booked ${rangeLabel}. Widen the period or clear a filter.`}
          />
        </CardContent>
      </Card>
    );
  }

  const trend = r.buckets.map((b) => b.value);
  const trendLabels = r.buckets.map((b) => b.label);
  const busyHours = r.byHour
    .map((n, h) => ({ h, n }))
    .filter((x) => x.n > 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Appointments" value={count(r.total)} hint={rangeLabel} trend={trend} trendLabels={trendLabels} />
        <StatCard label="Completed" value={count(r.completed)} hint={r.total ? `${pct(r.completed / r.total)} of all` : undefined} />
        <StatCard
          label="No-shows"
          value={count(r.noShow)}
          hint={`${pct(r.noShowRate)} of expected visits`}
          tone={r.noShowRate >= 0.15 ? "bad" : "default"}
        />
        <StatCard label="Cancelled" value={count(r.cancelled)} hint={`${pct(r.cancellationRate)} of all`} />
        <StatCard label="Patients" value={count(r.patients)} hint="Different patients booked" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appointments over time</CardTitle>
          <CardDescription>How many were booked for each {r.buckets.length > 31 ? "period" : "day"}, by the visit&apos;s date.</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart
            points={r.buckets}
            formatValue={count}
            valueLabel="Appointments"
            ariaLabel="Appointments over time"
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By status</CardTitle>
            <CardDescription>What became of the bookings.</CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart
              slices={r.byStatus.map((s) => ({ label: labelFrom(statuses, s.status), value: s.count }))}
              centerLabel="Appointments"
              formatValue={count}
              ariaLabel="Appointments by status"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By visit type</CardTitle>
            <CardDescription>
              Booked via {r.bySource.map((s) => `${labelFrom(sources, s.source)} ${count(s.count)}`).join(" · ")}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DonutChart
              slices={[
                { label: "Consultation", value: r.byType.consultation },
                { label: "Procedure", value: r.byType.procedure },
                { label: "Consultation + procedure", value: r.byType.both },
              ].filter((s) => s.value > 0)}
              centerLabel="Appointments"
              formatValue={count}
              ariaLabel="Appointments by visit type"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Busiest days</CardTitle>
            <CardDescription>Appointments by day of the week.</CardDescription>
          </CardHeader>
          <CardContent>
            <LollipopChart
              rows={WEEK_ORDER.map((d) => ({ label: WEEKDAYS[d], value: r.byWeekday[d] }))}
              formatValue={count}
              showShare
              ariaLabel="Appointments by day of the week"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Busiest times</CardTitle>
            <CardDescription>Appointments by the hour they start.</CardDescription>
          </CardHeader>
          <CardContent>
            <LollipopChart
              rows={busyHours.map((x) => ({ label: hourLabel(x.h), value: x.n }))}
              formatValue={count}
              showShare
              ariaLabel="Appointments by hour"
            />
          </CardContent>
        </Card>
      </div>

      <TableCard title="By doctor">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Doctor</TableHead>
              <TableHead className="text-right">Appointments</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">No-shows</TableHead>
              <TableHead className="text-right">Cancelled</TableHead>
              <TableHead className="text-right">No-show rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.byDoctor.map((d) => (
              <TableRow key={d.doctorId ?? "none"}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="text-right tabular-nums">{count(d.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(d.completed)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(d.noShow)}</TableCell>
                <TableCell className="text-right tabular-nums">{count(d.cancelled)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.completed + d.noShow > 0 ? pct(d.noShow / (d.completed + d.noShow)) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
