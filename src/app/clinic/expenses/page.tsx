import Link from "next/link";
import { getClinic } from "@/core/clinics/get-clinic";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth/user";
import { can } from "@/core/auth/permissions";
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
import { Pagination } from "@/core/ui/pagination";
import { parsePage, parsePageSize, pageOffset } from "@/core/lib/pagination";
import { ExpenseFilters } from "./expenses-filters";
import { AddExpenseForm, CategoryManager } from "./expense-ui";
import { ExpensesTable } from "./expenses-table";
import { asPaymentMethodCode } from "@/core/db/vocabulary-seed";

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

  const clinic = await getClinic(clinicId);
  if (!clinicHasFeature(clinic?.featuresEnabled, "finance")) notFound();

  await ensureDefaultCategories(clinicId);

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period, sp.from, sp.to, clinic?.createdAt);
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
      method: asPaymentMethodCode(sp.method),
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
          <p className="text-sm text-muted-foreground">The clinic&apos;s costs. Feeds the P&amp;L.</p>
        </div>
        <div className="flex items-center gap-4">
          {!deleted ? (
            <a
              href={`/api/finance/export?${new URLSearchParams({
                type: "expenses",
                ...(sp.period ? { period: sp.period } : {}),
                ...(sp.from ? { from: sp.from } : {}),
                ...(sp.to ? { to: sp.to } : {}),
                ...(sp.categoryId ? { categoryId: sp.categoryId } : {}),
                ...(sp.method ? { method: sp.method } : {}),
                ...(sp.q ? { q: sp.q } : {}),
              }).toString()}`}
              className="inline-flex min-h-6 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Export CSV
            </a>
          ) : null}
          <Link
            href={deleted ? "/clinic/expenses" : "/clinic/expenses?deleted=1"}
            className="inline-flex min-h-6 items-center text-sm text-muted-foreground underline underline-offset-4"
          >
            {deleted ? "← Back to expenses" : "View deleted"}
          </Link>
        </div>
      </div>

      {deleted ? (
        <p className="text-sm text-muted-foreground">Deleted expenses: restore any within reach.</p>
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

      <ExpensesTable
        rows={rows}
        canManage={canManage}
        empty={`No expenses${deleted ? " in the Trash" : " match these filters"}.`}
      />

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
