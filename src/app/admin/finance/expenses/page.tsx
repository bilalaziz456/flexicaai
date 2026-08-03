import { requireAdminCapability } from "@/core/auth/user";
import { canAdmin } from "@/core/auth/admin-permissions";
import {
  companyExpensesByCategory,
  companyExpensesTotal,
  companyExpensesTrend,
  ensureDefaultCompanyCategories,
  listCompanyCategories,
  listCompanyExpenses,
  listRecurringCompanyExpenses,
} from "@/core/admin/company-expenses";
import { resolveSalesRange } from "@/core/sales/report";
import { MultiBarChart } from "@/app/clinic/sales/multi-bar-chart";
import { HBarChart } from "@/app/clinic/sales/h-bar-chart";
import { parsePage, parsePageSize, pageOffset } from "@/core/lib/pagination";
import { Pagination } from "@/core/ui/pagination";
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
import { Badge } from "@/core/ui/badge";
import { ExpensesFilters } from "./expenses-filters";
import { AddCompanyExpenseForm, CompanyCategoryManager, CompanyExpenseRowActions, RecurringExpensesManager } from "./expense-ui";

const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

/**
 * Owner Finance — company operating expenses (Phase 2). FlexicaAI's own costs (payroll,
 * rent, software, …) with period/category/method/search filters, a monthly trend +
 * by-category breakdown graph, add/edit/delete (soft) + a Trash view, and category
 * management. Gated by `expenses:view`; create/edit/delete by `expenses:*`.
 */
export default async function CompanyExpensesPage({
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
  const user = await requireAdminCapability("expenses:view");
  const canCreate = canAdmin(user, "expenses:create");
  const canEdit = canAdmin(user, "expenses:edit");
  const canDelete = canAdmin(user, "expenses:delete");

  await ensureDefaultCompanyCategories();

  const sp = await searchParams;
  const range = resolveSalesRange(sp.period ?? "30d", sp.from, sp.to);
  const deleted = sp.deleted === "1";
  const page = parsePage(sp.page);
  const pageSize = parsePageSize(sp.size);

  const [{ rows, total }, rangeTotal, byCategory, trend, categories, recurring] = await Promise.all([
    listCompanyExpenses({
      from: range.start,
      toExclusive: range.end,
      categoryId: sp.categoryId || undefined,
      method: sp.method || undefined,
      q: sp.q?.trim() || undefined,
      deleted,
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    companyExpensesTotal(range.start, range.end),
    companyExpensesByCategory(range.start, range.end),
    companyExpensesTrend(range),
    listCompanyCategories(true),
    listRecurringCompanyExpenses(),
  ]);

  const rangeLabel = `${range.from} → ${range.to}`;
  const activeCategories = categories.filter((c) => c.isActive);
  const trendPoints = trend.map((b) => ({ label: b.label, values: { expenses: b.total } }));
  const hasTrend = trend.some((b) => b.total > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Company finance — operating expenses</h1>
        <p className="text-sm text-muted-foreground">
          FlexicaAI&apos;s own costs (payroll, rent, software, marketing…). Feeds the company P&amp;L.
        </p>
      </div>

      <ExpensesFilters
        period={range.period}
        from={range.from}
        to={range.to}
        categoryId={sp.categoryId ?? ""}
        method={sp.method ?? ""}
        q={sp.q ?? ""}
        deleted={deleted}
        categories={categories}
      />

      {/* KPI + graphs */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardDescription>Total expenses ({rangeLabel})</CardDescription></CardHeader>
          <CardContent><div className="text-2xl font-semibold tabular-nums">{rs(rangeTotal)}</div></CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Expense trend</CardTitle></CardHeader>
          <CardContent>
            {hasTrend ? (
              <MultiBarChart points={trendPoints} series={[{ key: "expenses", label: "Expenses", color: "#ef4444" }]} ariaLabel="Expenses by period" />
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No expenses in this period yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By category ({rangeLabel})</CardTitle>
          <CardDescription>Where the money goes, highest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {byCategory.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No expenses in this period yet.</p>
          ) : (
            <HBarChart ariaLabel="Company expenses by category" rows={byCategory.map((c) => ({ label: c.category, value: c.total }))} />
          )}
        </CardContent>
      </Card>

      {/* Recurring expenses — always shown (ongoing config, not a dated row). */}
      {(canEdit || recurring.length > 0) ? (
        <Card>
          <CardHeader>
            <CardTitle>Recurring expenses ({recurring.length})</CardTitle>
            <CardDescription>Ongoing costs — always shown regardless of the period. The cron materialises each into a dated expense per interval; edit or stop one here.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecurringExpensesManager templates={recurring} categories={activeCategories} canEdit={canEdit} canDelete={canDelete} />
          </CardContent>
        </Card>
      ) : null}

      {/* Add expense */}
      {canCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Record an expense</CardTitle>
            <CardDescription>Mark a repeating cost as recurring — the cron materialises it each period.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddCompanyExpenseForm categories={activeCategories} />
          </CardContent>
        </Card>
      ) : null}

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle>{deleted ? "Trashed expenses" : "Expenses"} ({total})</CardTitle>
          <CardDescription>{rangeLabel}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No {deleted ? "trashed " : ""}expenses match.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor / note</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {canEdit ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{r.incurredOn}</TableCell>
                    <TableCell>
                      {r.categoryName ?? <span className="text-muted-foreground">Uncategorized</span>}
                      {r.recurring ? <Badge variant="secondary" className="ml-1.5">recurring</Badge> : null}
                    </TableCell>
                    <TableCell className="max-w-[22rem] truncate">
                      {r.vendor ?? ""}
                      {r.note ? <span className="text-muted-foreground">{r.vendor ? " · " : ""}{r.note}</span> : ""}
                    </TableCell>
                    <TableCell className="capitalize">{r.method ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{rs(r.amount)}</TableCell>
                    {canEdit ? (
                      <TableCell className="text-right">
                        <CompanyExpenseRowActions id={r.id} deleted={r.deleted} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination page={page} pageSize={pageSize} total={total} basePath="/admin/finance/expenses" searchParams={sp} unit="expense" />
        </CardContent>
      </Card>

      {/* Categories */}
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Categories</CardTitle>
            <CardDescription>Add a category, or click one to deactivate/reactivate it (kept for history).</CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyCategoryManager categories={categories} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
