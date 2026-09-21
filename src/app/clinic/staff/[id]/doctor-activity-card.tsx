"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { buttonVariants } from "@/core/ui/button";
import { PeriodTabs } from "@/core/ui/report-filters";
import { DateRangeFields } from "@/core/ui/date-range-fields";
import { cn } from "@/core/lib/utils";
import {
  ACTIVITY_PRESETS,
  DEFAULT_ACTIVITY_PERIOD,
  type DoctorActivityPeriod,
} from "@/core/users/activity-periods";
import type { DoctorActivity } from "@/core/users/doctor-activity";
import { loadDoctorActivity } from "@/app/clinic/actions";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/**
 * What one doctor has been doing, over a window the reader chooses.
 *
 * A CLIENT component fetching through a server action, rather than a `?period=` the
 * page reads. This card sits on a page of editable forms — working hours, permissions,
 * revenue share — and a query-string change would re-render all of them, and anything
 * half-typed in them, to move four numbers in one card. The clinic scorecard resolves
 * the same tension the same way.
 *
 * The old figures stay on screen, dimmed, while a new window loads. A number that
 * blanks on every click is harder to read than one that is briefly stale, and here
 * nothing acts on the value — it is a page someone reads.
 */
export function DoctorActivityCard({
  doctorId,
  initial,
  initialFrom,
  initialTo,
}: {
  doctorId: string;
  initial: DoctorActivity;
  initialFrom: string;
  initialTo: string;
}) {
  const [activity, setActivity] = useState(initial);
  const [period, setPeriod] = useState<DoctorActivityPeriod>(DEFAULT_ACTIVITY_PERIOD);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(nextPeriod: DoctorActivityPeriod, nextFrom: string, nextTo: string) {
    setPeriod(nextPeriod);
    setFrom(nextFrom);
    setTo(nextTo);
    start(async () => {
      const res = await loadDoctorActivity(doctorId, nextPeriod, nextFrom, nextTo);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setError(null);
      setActivity(res.data);
      // The SERVER decides what the window actually was — it is what ran the query,
      // and it repairs a reversed range. Echoing its answer back into the date fields
      // keeps them describing the figures below rather than the request that was made.
      setFrom(res.from);
      setTo(res.to);
    });
  }

  const tiles = [
    {
      label: "Appointments",
      value: activity.appointments.toLocaleString("en-PK"),
      // EVERY bucket, or none. Naming two of the five read as a sum that did not come
      // out — 13 appointments, "5 completed · 4 cancelled" — and the missing four
      // looked like an error rather than the no-shows and the visits nobody had
      // closed out. A breakdown under a total is a promise that it reconciles, so the
      // terms are the outcomes plus the remainder, and only zero ones drop out.
      //
      // The spaces are non-breaking ON PURPOSE. Four terms do not fit a quarter-width
      // tile, and the first wrap landed between "5" and "cancelled" — a figure
      // orphaned from its noun. Binding each term, and binding the separator to the
      // term before it, leaves the only legal break points AFTER a "·".
      hint:
        [
          activity.completed ? `${activity.completed} completed` : null,
          activity.noShows ? `${activity.noShows} no-show` : null,
          activity.cancelled ? `${activity.cancelled} cancelled` : null,
          activity.stillOpen ? `${activity.stillOpen} still open` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "none booked",
    },
    {
      label: "No-show rate",
      value: activity.noShowRate === null ? "—" : `${Math.round(activity.noShowRate * 100)}%`,
      // The denominator is EXPECTED visits, and saying so matters: a rate over
      // everything booked would fall every time someone cancelled a week ahead.
      hint:
        activity.noShowRate === null
          ? "no completed or missed visits yet"
          : `${activity.noShows} of ${activity.completed + activity.noShows} expected`,
    },
    {
      label: "Visits recorded",
      value: activity.visits.toLocaleString("en-PK"),
      hint: `${activity.scribeRuns} dictated`,
    },
    {
      label: "Earned",
      value: rs(activity.earnedInWindow),
      hint: activity.hasShareRate ? "revenue share, this window" : "no share percentage set",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-5 text-muted-foreground" aria-hidden="true" />
          Activity
        </CardTitle>
        <CardDescription>
          Figures, not a score — each one is shown with what it is measured against,
          because a single number over these would hide more than it told you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The same pills and date fields every report on the workspace uses, with a
            months ladder instead of the reports' day presets (`activity-periods.ts`
            says why). Editing a date is the custom path and lights no pill — that
            behaviour comes with the shared controls rather than being re-invented. */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 well p-3">
          <PeriodTabs
            value={period}
            presets={ACTIVITY_PRESETS}
            onChange={(v) => {
              const p = v as DoctorActivityPeriod;
              // A preset derives its own dates on the server, so the two sent here
              // are ignored for anything but "custom".
              load(p, from, to);
            }}
          />
          {/* `idPrefix` is not optional here even though it looks it: the Leave &
              vacation card further down this same page has its own From/To pair, and
              two elements sharing an id means a label points at whichever the browser
              happens to find first. Theirs are already suffixed by doctor id. */}
          <DateRangeFields
            idPrefix="activity-"
            from={from}
            to={to}
            onFrom={(v) => load("custom", v, to)}
            onTo={(v) => load("custom", from, v)}
          />
          {/* No echo of the window here: the two date fields beside it already say
              what it is, in a format a person reads, and printing "2026-06-22 to
              2026-09-22" next to "Mon, 22 Jun 2026" was the same fact twice with the
              uglier one last. This slot is for the one thing they cannot show. */}
          {error ? (
            <span className="ml-auto self-center text-[11px] text-destructive">{error}</span>
          ) : null}
        </div>

        <div
          className={cn(
            "grid grid-cols-1 overflow-hidden rounded-lg border border-border/60 transition-opacity sm:grid-cols-2 lg:grid-cols-4",
            pending && "opacity-60",
          )}
          aria-busy={pending}
        >
          {tiles.map((k, i, all) => (
            <div
              key={k.label}
              className={cn(
                "p-4",
                i < all.length - 1 && "border-b border-border/60",
                i >= all.length - 2 && "sm:border-b-0",
                i < all.length - 4 ? "lg:border-b" : "lg:border-b-0",
                i % 2 === 0 && "sm:border-r sm:border-border/60",
                (i + 1) % 4 === 0 ? "lg:border-r-0" : "lg:border-r lg:border-border/60",
              )}
            >
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{k.value}</div>
              <div className="text-xs text-muted-foreground">{k.hint}</div>
            </div>
          ))}
        </div>

        {/* The BALANCE. Same ledger the shares page settles against, read rather than
            re-derived — and LIFETIME, so unlike everything above it the window does
            not move it. That is why it says "Lifetime" out loud.

            It LEADS WITH WHAT IT MEANS, because the arithmetic alone was misleading in
            the one case that matters. A NEGATIVE balance does not mean a small amount
            is outstanding — it means the money runs the other way, and the doctor owes
            the clinic (they bore a discount). Printing that as "Rs -9,868 outstanding"
            said the opposite of the truth while looking precise, and put the minus
            sign in a different place from the one on the adjustment beside it. Which
            side owes is the fact; the terms are the working, so they sit underneath in
            smaller type and the zero ones are left out. */}
        {activity.hasShareRate ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 well p-3">
            <div className="text-sm">
              <div>
                {activity.outstanding > 0 ? (
                  <>
                    <span className="font-medium">{rs(activity.outstanding)}</span>{" "}
                    <span className="text-muted-foreground">owed to this doctor</span>
                  </>
                ) : activity.outstanding < 0 ? (
                  <>
                    <span className="font-medium">{rs(Math.abs(activity.outstanding))}</span>{" "}
                    <span className="text-muted-foreground">owed BY this doctor to the clinic</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Settled up — nothing owed either way
                  </span>
                )}
              </div>
              {/* The working. Earnings ALWAYS lead, even at zero — they are what the
                  other two terms modify, and "less Rs 9,868 in adjustments" standing
                  alone reads as a fragment rather than a subtraction. A zero
                  adjustment or payout is dropped: those are genuinely absent rather
                  than a starting point of nothing. */}
              <div className="mt-0.5 text-xs text-muted-foreground">
                Lifetime:{" "}
                {[
                  `${rs(activity.earnedLifetime)} earned`,
                  activity.adjustments !== 0
                    ? `${activity.adjustments < 0 ? "less " : "plus "}${rs(Math.abs(activity.adjustments))} in adjustments`
                    : null,
                  activity.paidLifetime !== 0 ? `${rs(activity.paidLifetime)} paid out` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            </div>
            <Link
              href={`/clinic/shares?doctorId=${doctorId}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Open shares
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
