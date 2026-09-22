import { notFound } from "next/navigation";
import { Banknote, Scale } from "lucide-react";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { getClinic } from "@/core/clinics/get-clinic";
import { clinicHasFeature } from "@/core/lib/features";
import {
  getDrawerState,
  listCashCounts,
  listRecentTransfers,
} from "@/core/finance/petty-cash";
import { vocabularyLabel } from "@/core/db/vocabulary-cache";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { TableCard } from "@/core/ui/table-card";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";
import { CountForm, TransferForm } from "./cash-ui";
import { CountRowActions, MoveRowActions } from "./history-actions";

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
export default async function CashPage() {
  const user = await requireWorkspace("cash");
  const { clinicId } = user;

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  const canCount = can(user, "cash", "create");
  const [drawer, counts, transfers] = await Promise.all([
    getDrawerState(clinicId),
    listCashCounts(clinicId),
    listRecentTransfers(clinicId, 10),
  ]);

  const m = drawer.movement;
  const untendered = m.untendered.expenses + m.untendered.payouts + m.untendered.payments;

  // Counts and moves as ONE chronology. They are different rows in the database for
  // good reasons — a count is a reconciliation, a move is money going somewhere — but
  // to a person reading the drawer they are the same question in time order: what
  // happened to this box, and when.
  const history = [
    ...counts.map((c) => ({
      id: c.id,
      kind: "count" as const,
      at: c.countedAt,
      what: "Counted",
      amount: rs(c.countedTotal),
      difference:
        c.variance === null
          ? "opening float"
          : c.variance === 0
            ? "balanced"
            : `${c.variance > 0 ? "+" : "−"}${rs(Math.abs(c.variance))}`,
      tone:
        c.variance === null
          ? "text-muted-foreground"
          : c.variance === 0
            ? "text-success-text"
            : c.variance < 0
              ? "text-destructive"
              : "text-warning-text",
      by: c.countedByName,
      note: c.note,
      row: c,
    })),
    ...transfers.map((t) => ({
      id: t.id,
      kind: "move" as const,
      at: t.occurredAt,
      // The label is the database's, not this file's (ADR-027).
      what: vocabularyLabel("cash_transfer_kinds", t.kind),
      amount: `${t.kind === "float_topup" ? "+ " : "− "}${rs(t.amount)}`,
      difference: "",
      tone: "",
      by: t.createdByName,
      note: t.reference ?? t.note,
      row: t,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

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
                      {h.kind === "count" ? (
                        <CountRowActions id={h.row.id} note={h.row.note} />
                      ) : (
                        <MoveRowActions
                          id={h.row.id}
                          kind={h.row.kind}
                          amount={h.row.amount}
                          reference={h.row.reference}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}