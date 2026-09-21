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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { TableCard } from "@/core/ui/table-card";
import { EmptyState } from "@/core/ui/empty-state";
import { PageHeader } from "@/core/ui/page-header";
import { CountForm, TransferForm } from "./cash-ui";

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
                    { label: "Opened with", value: drawer.openingTotal, sign: "" },
                    m.collected ? { label: "Cash taken", value: m.collected, sign: "+" } : null,
                    m.transfersIn ? { label: "Float added", value: m.transfersIn, sign: "+" } : null,
                    m.expenses ? { label: "Paid out in cash", value: m.expenses, sign: "−" } : null,
                    m.payouts ? { label: "Paid to doctors", value: m.payouts, sign: "−" } : null,
                    m.refunded ? { label: "Refunded", value: m.refunded, sign: "−" } : null,
                    m.transfersOut ? { label: "Banked or taken", value: m.transfersOut, sign: "−" } : null,
                  ]
                    .filter((k) => k !== null)
                    .map((k) => (
                      <div key={k.label} className="flex items-baseline justify-between gap-4 px-3 py-2">
                        <dt className="text-sm text-muted-foreground">{k.label}</dt>
                        <dd className="text-sm font-medium tabular-nums">
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
                <TransferForm />
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      <TableCard title={`${counts.length} ${counts.length === 1 ? "count" : "counts"}`}>
        {counts.length === 0 ? (
          <EmptyState
            compact
            icon={Scale}
            title="No counts yet"
            description="Each handover count is kept here with what it expected, what was found, and who counted."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Counted</th>
                <th className="px-3 py-2 text-right font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Found</th>
                <th className="px-3 py-2 text-right font-medium">Difference</th>
                <th className="px-3 py-2 text-left font-medium">By</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {counts.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{when(c.countedAt)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {c.expectedTotal === null ? "—" : rs(c.expectedTotal)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{rs(c.countedTotal)}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      c.variance === null
                        ? "text-muted-foreground"
                        : c.variance === 0
                          ? "text-success-text"
                          : c.variance < 0
                            ? "text-destructive"
                            : "text-warning-text"
                    }`}
                  >
                    {c.variance === null
                      ? "opening float"
                      : c.variance === 0
                        ? "balanced"
                        : `${c.variance > 0 ? "+" : "−"}${rs(Math.abs(c.variance))}`}
                  </td>
                  <td className="px-3 py-2">{c.countedByName ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {transfers.length > 0 ? (
        <TableCard title="Recent cash moves">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">What</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Reference</th>
                <th className="px-3 py-2 text-left font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{when(t.occurredAt)}</td>
                  <td className="px-3 py-2">
                    {t.kind === "bank_deposit"
                      ? "Banked"
                      : t.kind === "owner_draw"
                        ? "Taken by owner"
                        : "Float added"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.kind === "float_topup" ? "+ " : "− "}
                    {rs(t.amount)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t.reference ?? "—"}</td>
                  <td className="px-3 py-2">{t.createdByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      ) : null}
    </div>
  );
}
