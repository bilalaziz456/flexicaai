import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
import { db } from "@/core/db";
import { clinics } from "@/core/db/schema";
import { clinicHasFeature } from "@/core/lib/features";
import { resolveSalesRange } from "@/core/sales/report";
import {
  ensureDefaultCategories,
  expensesTotal,
  listCategories,
  listExpenses,
} from "@/core/expenses";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { Badge } from "@/core/ui/badge";
import { Pagination } from "@/core/ui/pagination";
import { parsePage, parsePageSize, pageOffset } from "@/core/lib/pagination";
import { ExpenseFilters } from "./expenses-filters";
import { AddExpenseForm, CategoryManager, ExpenseRowActions } from "./expense-ui";

const money = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

/**
 * Expenses (Finance) — the clinic's costs, feeding the P&L. Add/edit/delete (soft),
 * categories, and a deleted view. Gated by the `finance` feature + `expenses`
 * permission.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    categoryId?: string;
    method?: string;
    q?: string;
    deleted?: string;
    page?: string;
    size?: string;
  }>;
}) {
  const user = await requireWorkspace("expenses");
  const { clinicId } = user;

  const [clinic] = await db
    .select({ featuresEnabled: clinics.featuresEnabled })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  await ensureDefaultCategories(clinicId);

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to);
  const deleted = sp.deleted === "1";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);
  const canManage = can(user, "expenses", "create");

  const [categories, { rows, total }, periodTotal] = await Promise.all([
    listCategories(clinicId, true),
    listExpenses(clinicId, {
      from: range.start,
      toExclusive: range.end,
      categoryId: sp.categoryId?.trim() || undefined,
      method: sp.method?.trim() || undefined,
      q: sp.q?.trim() || undefined,
      deleted,
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    expensesTotal(clinicId, range.start, range.end),
  ]);
  const activeCategories = categories.filter((c) => c.isActive);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Expenses</h1>
          <p className="text-sm text-muted-foreground">The clinic&apos;s costs — feeds the P&amp;L.</p>
        </div>
        <Link
          href={deleted ? "/clinic/expenses" : "/clinic/expenses?deleted=1"}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          {deleted ? "← Back to expenses" : "View deleted"}
        </Link>
      </div>

      {deleted ? (
        <p className="text-sm text-muted-foreground">Deleted expenses — restore any within reach.</p>
      ) : (
        <>
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Add expense</CardTitle>
              </CardHeader>
              <CardContent>
                <AddExpenseForm categories={activeCategories} />
              </CardContent>
            </Card>
          ) : null}

          <ExpenseFilters
            period={range.period}
            from={range.from}
            to={range.to}
            categoryId={sp.categoryId?.trim() || ""}
            method={sp.method?.trim() || ""}
            q={sp.q?.trim() || ""}
            categories={activeCategories}
          />

          <Card>
            <CardHeader>
              <CardDescription>Total this period</CardDescription>
              <CardTitle className="text-3xl">{money.format(periodTotal)}</CardTitle>
            </CardHeader>
          </Card>
        </>
      )}

      <Pagination page={page} pageSize={pageSize} total={total} basePath="/clinic/expenses" searchParams={sp} unit="expense" />

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No expenses{deleted ? " in the Trash" : " match these filters"}.
        </p>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Category</th>
                  <th className="pb-2 font-normal">Vendor</th>
                  <th className="pb-2 font-normal">Method</th>
                  <th className="pb-2 text-right font-normal">Amount</th>
                  <th className="pb-2 text-right font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 whitespace-nowrap">{e.incurredOn}</td>
                    <td className="py-2">
                      {e.categoryName ?? "—"}
                      {e.recurring ? <Badge variant="outline" className="ml-1.5">Recurring</Badge> : null}
                    </td>
                    <td className="py-2">
                      {e.vendor ?? "—"}
                      {e.note ? <span className="block text-xs text-muted-foreground">{e.note}</span> : null}
                    </td>
                    <td className="py-2 capitalize">{e.method ?? "—"}</td>
                    <td className="py-2 text-right font-medium tabular-nums">{money.format(e.amount)}</td>
                    <td className="py-2 text-right">
                      {canManage ? <ExpenseRowActions id={e.id} deleted={e.deleted} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile */}
          <ul className="space-y-2 md:hidden">
            {rows.map((e) => (
              <li key={e.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.categoryName ?? "Uncategorized"}</span>
                  <span className="font-medium tabular-nums">{money.format(e.amount)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {e.incurredOn}
                  {e.vendor ? ` · ${e.vendor}` : ""}
                  {e.method ? ` · ${e.method}` : ""}
                  {e.recurring ? " · recurring" : ""}
                </div>
                {e.note ? <div className="text-xs">{e.note}</div> : null}
                {canManage ? (
                  <div className="mt-1">
                    <ExpenseRowActions id={e.id} deleted={e.deleted} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {!deleted && canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Categories</CardTitle>
            <CardDescription>Add categories, or tap one to activate/deactivate it.</CardDescription>
          </CardHeader>
          <CardContent>
            <CategoryManager categories={categories} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
