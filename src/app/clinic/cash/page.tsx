import { notFound } from "next/navigation";
import { Banknote, Scale } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import { getDrawerState, listDrawerHistory } from "@/core/finance/petty-cash";
import { Pagination } from "@/core/ui/pagination";
import { pageOffset, parsePage, parsePageSize } from "@/core/lib/pagination";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { TableCard } from "@/core/ui/table-card";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";
import { SalesFilters } from "@/core/ui/report-filters";
import { resolveSalesRange } from "@/core/sales/report";
import { CountForm, TransferForm } from "./cash-ui";
import { CountRowActions, MoveRowActions } from "./history-actions";
import { mayModifyEntry } from "./ownership";
import Link from "next/link";
import { buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;
const when = (d: Date) =>
  d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

/**
 * Petty cash — the shared front-desk drawer, reconciled at each handover.
 *
 * Reads the three cash ledgers; stores only the count and the transfers (see
 * `core/finance/petty-cash.ts` and docs/petty-cash-plan.md). Gated by the `finance`
 * feature ∩ the `cash` permission.
 */
export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; page?: string; size?: string }>;
}) {
  const user = await requireWorkspace("cash");
  const { clinicId } = user;

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  const canCount = can(user, "cash", "create");

  // The range bounds the HISTORY ONLY — never `getDrawerState`. What should be in the
  // drawer is a fact about right now, reckoned from the newest count whenever that
  // was; filtering it would print a confident figure that answers no question anyone
  // has ("expected Rs 4,300 in September" says nothing about the box on the desk).
  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "quarter", sp.from, sp.to, clinic?.createdAt);

  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const [drawer, historyPage] = await Promise.all([
    getDrawerState(clinicId),
    listDrawerHistory(clinicId, {
      from: range.start,
      to: range.end,
      offset: pageOffset(page, pageSize),
      limit: pageSize,
    }),
  ]);

  const m = drawer.movement;
  const untendered = m.untendered.expenses + m.untendered.payouts + m.untendered.payments;

  // Counts and moves as ONE chronology. They are different rows in the database for
  // good reasons — a count is a reconciliation, a move is money going somewhere — but
  // to a person reading the drawer they are the same question in time order: what
  // happened to this box, and when.
  // The merge, the sort and the page are done in core (ADR-024); this only decides
  // how each row READS.
  const history = historyPage.rows.map((e) =>
    e.kind === "ledger"
      ? {
          // Borrowed from another ledger, so it is shown and not offered for editing:
          // a payment belongs to billing and an expense to Expenses, each with its own
          // permissions and void rules.
          id: e.ledger.id,
          kind: "ledger" as const,
          at: e.at,
          what: e.ledger.label,
          // Where the row actually lives, so a borrowed entry is a signpost rather
          // than a dead end. The drawer reads these ledgers; it does not own them.
          href: e.ledger.href,
          amount: `${e.ledger.delta >= 0 ? "+ " : "− "}${rs(Math.abs(e.ledger.delta))}`,
          difference: "",
          tone: "",
          by: e.ledger.by,
          note: e.ledger.detail,
          count: null,
          move: null,
          mine: false,
        }
      : e.kind === "count"
      ? {
          id: e.count.id,
          kind: "count" as const,
          at: e.at,
          what: "Counted",
          amount: rs(e.count.countedTotal),
          difference:
            e.count.variance === null
              ? "opening float"
              : e.count.variance === 0
                ? "balanced"
                : `${e.count.variance > 0 ? "+" : "−"}${rs(Math.abs(e.count.variance))}`,
          tone:
            e.count.variance === null
              ? "text-muted-foreground"
              : e.count.variance === 0
                ? "text-success-text"
                : e.count.variance < 0
                  ? "text-destructive"
                  : "text-warning-text",
          by: e.count.countedByName,
          note: e.count.note,
          href: null,
          count: e.count,
          move: null,
          mine: mayModifyEntry(user, e.count.countedBy),
        }
      : {
          id: e.move.id,
          kind: "move" as const,
          at: e.at,
          // The label is the database's, not this file's (ADR-027).
          what: vocabularyLabel("cash_transfer_kinds", e.move.kind),
          amount: `${e.move.kind === "float_topup" ? "+ " : "− "}${rs(e.move.amount)}`,
          difference: "",
          tone: "",
          by: e.move.createdByName,
          note: e.move.reference ?? e.move.note,
          href: null,
          count: null,
          move: e.move,
          mine: mayModifyEntry(user, e.move.createdBy),
        },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Petty cash"
        description="One shared drawer, counted at handover. Every figure below is read from the money already recorded — nothing here is a second ledger."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="size-5 text-muted-foreground" aria-hidden="true" />
              What should be in the drawer
            </CardTitle>
            <CardDescription>
              {drawer.openedAt
                ? `Since the last count, ${when(drawer.openedAt)}.`
                : "Nothing has been counted yet, so there is no opening float to reckon from."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {drawer.expected === null ? (
              // Not zero. "I do not know what was in the box" and "the box is empty"
              // are different claims, and printing 0 for the first is a lie a reader
              // cannot detect.
              <EmptyState
                compact
                icon={Banknote}
                title="No opening float recorded"
                description="Count what is in the drawer now. That first count becomes the float every later handover is measured against."
              />
            ) : (
              <>
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{rs(drawer.expected)}</div>
                  <p className="text-xs text-muted-foreground">expected in the drawer right now</p>
                </div>

                {/* The working, so the figure is answerable rather than asserted.
                    READS DOWN, not across. It was a row of tiles, which is the wrong
                    shape twice over: the number of terms VARIES (the two transfer
                    lines appear only when there were transfers), so a fixed
                    three-column grid left a four-term sum sitting in two rows with a
                    hole in it — and more fundamentally, a sum is read by running an
                    eye down a column of figures with the operators lined up. Across a
                    row the reader has to hunt for the sign.
                    Zero terms drop out, except the opening float: it is what the rest
                    modify, so it stays even at zero. */}
                <dl className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
                  {[
                    { label: "Opened with", value: drawer.openingTotal, sign: "", why: [] },
                    m.collected ? { label: "Cash taken", value: m.collected, sign: "+", why: [] } : null,
                    m.transfersIn ? { label: "Float added", value: m.transfersIn, sign: "+", why: [] } : null,
                    m.expenses
                      ? { label: "Paid out in cash", value: m.expenses, sign: "−", why: m.reasons.spent }
                      : null,
                    m.payouts ? { label: "Paid to doctors", value: m.payouts, sign: "−", why: [] } : null,
                    m.refunded ? { label: "Refunded", value: m.refunded, sign: "−", why: [] } : null,
                    m.transfersOut
                      ? { label: "Banked or taken", value: m.transfersOut, sign: "−", why: m.reasons.moved }
                      : null,
                  ]
                    .filter((k) => k !== null)
                    .map((k) => (
                      <div key={k.label} className="flex items-baseline justify-between gap-4 px-3 py-2">
                        <dt className="min-w-0 text-sm text-muted-foreground">
                          {k.label}
                          {/* WHY the money went, under the line it belongs to. A sum
                              says the drawer is lighter; this is what lets somebody
                              say whether that is right, without opening Expenses. */}
                          {k.why.length > 0 ? (
                            <span className="block truncate text-xs text-muted-foreground/80">
                              {k.why.slice(0, 3).join(" · ")}
                              {k.why.length > 3 ? ` · +${k.why.length - 3} more` : ""}
                            </span>
                          ) : null}
                        </dt>
                        <dd className="shrink-0 self-start text-sm font-medium tabular-nums">
                          {k.sign ? `${k.sign} ` : ""}
                          {rs(k.value)}
                        </dd>
                      </div>
                    ))}
                  <div className="flex items-baseline justify-between gap-4 px-3 py-2">
                    <dt className="text-sm font-medium">Should be in the drawer</dt>
                    <dd className="text-sm font-semibold tabular-nums">{rs(drawer.expected)}</dd>
                  </div>
                </dl>

                {untendered > 0 ? (
                  // Shown, never folded in. Money recorded with no tender might have
                  // been cash; guessing either way would put a number in front of
                  // somebody that they cannot check.
                  <p className="rounded-lg border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-warning-text">
                    {rs(untendered)} was recorded since the last count with no payment
                    method set, so it is not counted above. If some of it was cash, the
                    drawer will be short by that much.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        {canCount ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Count the drawer</CardTitle>
                <CardDescription>
                  {drawer.expected === null
                    ? "The first count is the opening float."
                    : "At handover, or whenever you need to know."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CountForm expected={drawer.expected} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Move cash</CardTitle>
                <CardDescription>
                  Banking the takings or topping the float up. Not an expense — it buys
                  nothing, so it never reaches the P&amp;L.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TransferForm canSpend={can(user, "expenses", "create")} />
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      {/* ONE history, in time order.
          It was two tables — counts in one, transfers in the other — which split a
          single story by row TYPE. They interleave in time (a float top-up, a draw,
          then the count that closes the period), so the sequence, which is the only
          thing that explains a figure, was the one thing you could not see. A cash
          book is a chronology; this is that. */}
      {/* The filter sits WITH the history, not at the top of the page, so what it
          bounds is unambiguous: the card above is "right now" and does not move. */}
      <div className="space-y-3">
        <SalesFilters
          period={range.period}
          from={range.from}
          to={range.to}
          doctorId=""
          doctors={[]}
          showDoctor={false}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={historyPage.total}
          basePath="/clinic/cash"
          searchParams={{ period: range.period, from: sp.from, to: sp.to, size: sp.size }}
          unit="entry"
        />

        <TableCard title="Drawer history">
        {history.length === 0 ? (
          <EmptyState
            compact
            icon={Scale}
            title="Nothing recorded yet"
            description="Counts and cash moves both land here, newest first, so the drawer reads as one story."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">What</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
                <th className="px-3 py-2 text-left font-medium">By</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
                {canCount ? <th className="px-3 py-2 text-right font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {history.map((h) => (
                <tr key={h.id} className={h.kind === "count" ? "bg-surface-sunken/60" : ""}>
                  <td className="px-3 py-2 whitespace-nowrap">{when(h.at)}</td>
                  {/* A count is the event that closes a period, so it is named as the
                      action it is and given a tint — the moves between two counts
                      belong to the count above them. */}
                  <td className={`px-3 py-2 ${h.kind === "count" ? "font-medium" : ""}`}>{h.what}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{h.amount}</td>
                  <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${h.tone}`}>{h.difference}</td>
                  <td className="px-3 py-2">{h.by ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{h.note ?? "—"}</td>
                  {canCount ? (
                    <td className="px-3 py-2 text-right">
                      {h.count && h.mine ? (
                        <CountRowActions
                          id={h.count.id}
                          counted={h.count.countedTotal}
                          note={h.count.note}
                        />
                      ) : h.move && h.mine ? (
                        <MoveRowActions
                          id={h.move.id}
                          kind={h.move.kind}
                          amount={h.move.amount}
                          reference={h.move.reference}
                        />
                      ) : h.href ? (
                        // Not editable HERE, on purpose: a payment is owned by billing
                        // and an expense by Expenses, each with its own permissions,
                        // void rules and audit trail. A second way to change the same
                        // record is the thing this feature exists to avoid — so the row
                        // points at the screen that does own it.
                        <Link
                          href={h.href}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                        >
                          Open
                        </Link>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </TableCard>
      </div>
    </div>
  );
}