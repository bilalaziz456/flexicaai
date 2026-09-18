import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import { computeServingCost, effectiveTaxPct, getCostRates } from "@/core/admin/cost";
import { resolveSalesRange } from "@/core/sales/report";
import { TrendChart } from "@/core/ui/charts/trend-chart";
import { StatCard } from "@/core/ui/charts/stat-card";
import { DonutChart } from "@/core/ui/charts/donut-chart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/core/ui/table";
import { CostFilters } from "./cost-filters";
import { CostRatesForm } from "./cost-rates-form";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/**
 * Owner Finance — serving-cost tracking (Phase 1). FlexicaAI's estimated variable cost
 * (AI scribe + WhatsApp) over a chosen period, with a scribe-vs-WhatsApp cost trend
 * and a per-clinic breakdown, driven by the configurable unit rates. Gated by
 * `serving_cost:view`; rate editing by `serving_cost:edit`.
 */
export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireAdminCapability("serving_cost:view");
  const canEdit = canAdmin(user, "serving_cost:edit");

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "30d", sp.from, sp.to);
  const [rates, cost] = await Promise.all([getCostRates(), computeServingCost(range)]);
  const rangeLabel = `${range.from} → ${range.to}`;
  const notConfigured = rates.effectiveFrom === null || rates.usdToPkr === 0;

  // Summed from the same buckets the chart draws, so the ring and the curve can
  // never disagree about the period's total.
  const scribeTotal = cost.trend.reduce((a, b) => a + b.scribeCostPkr, 0);
  const whatsappTotal = cost.trend.reduce((a, b) => a + b.whatsappCostPkr, 0);
  const hasTrend = cost.trend.some((b) => b.costPkr > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Company finance: serving cost</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          FlexicaAI&apos;s estimated variable cost of serving clinics (AI scribe + WhatsApp).
          Counts × your unit rates.
        </p>
      </div>

      <CostFilters period={range.period} from={range.from} to={range.to} />

      {notConfigured ? (
        <div className="rounded-md border border-warning/35 bg-warning/[0.06] p-3 text-sm text-warning-text">
          Cost rates aren&apos;t set yet, so estimated cost shows Rs 0. {canEdit ? "Set them below." : "An admin with finance access can set them."}
        </div>
      ) : null}

      {/* Cost KPIs for the range */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Estimated cost"
          value={rs(cost.totalCostPkr)}
          hint={rangeLabel}
          trend={cost.trend.map((b) => b.costPkr)}
          higherIsBetter={false}
        />
        <StatCard
          label="Scribe calls"
          value={cost.totalScribeCalls.toLocaleString("en-PK")}
          hint="Voice visits"
        />
        <StatCard
          label="WhatsApp messages"
          value={cost.totalWhatsappMsgs.toLocaleString("en-PK")}
          hint="Outbound"
        />
      </div>

      {/* Cost trend */}
      <Card>
        <CardHeader>
          <CardTitle>Cost trend</CardTitle>
          <CardDescription>Estimated cost by period. AI scribe vs WhatsApp ({rangeLabel}).</CardDescription>
        </CardHeader>
        <CardContent>
          {hasTrend ? (
            <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-center">
              {/* The TOTAL as a shape over time… */}
              <TrendChart
                points={cost.trend.map((b) => ({ label: b.label, value: b.costPkr }))}
                ariaLabel="Serving cost over time"
                valueLabel="Serving cost"
                color="var(--color-chart-4)"
              />
              {/* …and what it is made of, which two bar series made you add up
                  by eye. Whisper and WhatsApp are the whole cost, so a share is
                  meaningful. */}
              <DonutChart
                ariaLabel="Serving cost by provider"
                centerLabel="Serving cost"
                total={cost.totalCostPkr}
                size={140}
                slices={[
                  { label: "Scribe (AI)", value: scribeTotal, color: "var(--color-chart-2)" },
                  { label: "WhatsApp", value: whatsappTotal, color: "var(--color-chart-3)" },
                ]}
              />
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No usage in this period yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Rates */}
      <Card>
        <CardHeader>
          <CardTitle>Unit cost rates</CardTitle>
          <CardDescription>
            {rates.effectiveFrom
              ? `Current since ${rates.effectiveFrom.toLocaleDateString()}. Editing saves a new version (history kept).`
              : "Not configured yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <CostRatesForm
              scribeCallCost={rates.scribeCallCost}
              whatsappMsgCost={rates.whatsappMsgCost}
              whisperMinuteCost={rates.whisperMinuteCost}
              claudeInputCost={rates.claudeInputCost}
              claudeOutputCost={rates.claudeOutputCost}
              usdToPkr={rates.usdToPkr}
              taxMode={rates.taxMode}
              foreignTxnFeePct={rates.foreignTxnFeePct}
              fedPct={rates.fedPct}
              advanceTaxPct={rates.advanceTaxPct}
              additionalTaxPct={rates.additionalTaxPct}
              totalTaxPct={rates.totalTaxPct}
            />
          ) : (
            <dl className="grid gap-3 sm:grid-cols-3 text-sm">
              <div><dt className="text-muted-foreground">Whisper / audio min</dt><dd className="font-medium">{rates.currency} {rates.whisperMinuteCost}</dd></div>
              <div><dt className="text-muted-foreground">Claude in / out (1M)</dt><dd className="font-medium">{rates.currency} {rates.claudeInputCost} / {rates.claudeOutputCost}</dd></div>
              <div><dt className="text-muted-foreground">WhatsApp message</dt><dd className="font-medium">{rates.currency} {rates.whatsappMsgCost}</dd></div>
              <div><dt className="text-muted-foreground">Scribe call (fallback)</dt><dd className="font-medium">{rates.currency} {rates.scribeCallCost}</dd></div>
              <div><dt className="text-muted-foreground">USD → PKR</dt><dd className="font-medium">{rates.usdToPkr}</dd></div>
              <div><dt className="text-muted-foreground">Bank tax (int&apos;l)</dt><dd className="font-medium">{effectiveTaxPct(rates)}%</dd></div>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Per-clinic breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Cost by clinic</CardTitle>
          <CardDescription>Highest cost first ({rangeLabel}). Estimate: counts × the current rates.</CardDescription>
        </CardHeader>
        <CardContent>
          {cost.perClinic.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No scribe or WhatsApp usage in this period yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clinic</TableHead>
                  <TableHead className="text-right">Scribe calls</TableHead>
                  <TableHead className="text-right">WhatsApp</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cost.perClinic.map((c) => (
                  <TableRow key={c.clinicId}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.scribeCalls.toLocaleString("en-PK")}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.whatsappMsgs.toLocaleString("en-PK")}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(c.costPkr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
