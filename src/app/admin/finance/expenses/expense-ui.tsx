"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import {
  saveCompanyExpense,
  deleteCompanyExpenseAction,
  restoreCompanyExpenseAction,
  addCompanyCategoryAction,
  toggleCompanyCategoryAction,
  type ExpenseActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { DatePicker } from "@/core/ui/date-picker";
import { Toast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { useTenderOptions } from "@/core/ui/vocabulary-provider";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const selectCls = `${inputCls} select-chevron pr-8`;
const rs = (n: number) => `Rs ${n.toLocaleString("en-PK")}`;

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The fields an edit prefills (a superset of RecurringExpense from the core layer). */
export type EditableExpense = {
  id: string;
  categoryId: string | null;
  amount: number;
  incurredOn: string;
  vendor: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  recurrence: string | null; // non-null = recurring
};

/**
 * Create or EDIT a company expense. Pass `expense` to edit (prefilled; the recurring
 * toggle + interval reflect the existing row); omit it to record a new one. On save
 * an edit calls `onDone` (to collapse an inline editor) while a create resets.
 */
export function CompanyExpenseForm({
  categories,
  expense,
  onDone,
}: {
  categories: { id: string; name: string }[];
  expense?: EditableExpense;
  onDone?: () => void;
}) {
  // Methods come from the database (ADR-027): active only, in its own order.
  const methodOptions = useTenderOptions();
  const isEdit = !!expense;
  const [state, formAction, pending] = useActionState<ExpenseActionState, FormData>(
    saveCompanyExpense.bind(null, expense?.id ?? null),
    {},
  );
  const [nonce, setNonce] = useState(0);
  const [date, setDate] = useState(expense?.incurredOn ?? todayStr());
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  useEffect(() => {
    if (state.saved) {
      if (isEdit) onDone?.();
      else {
        setAmount("");
        setDate(todayStr());
        setCategoryId("");
      }
    }
    if (state.saved || state.error) setNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const categoryOptions = [{ value: "", label: "Uncategorized" }, ...categories.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SearchableSelect
          label="Category"
          ariaLabel="Expense category"
          name="categoryId"
          value={categoryId}
          onChange={setCategoryId}
          options={categoryOptions}
          placeholder="Category"
          className="w-full"
        />
        <div className="space-y-1">
          <Label htmlFor="ex-amount" className="text-xs text-muted-foreground">Amount (Rs)</Label>
          <input
            id="ex-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            className={inputCls}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ex-date" className="text-xs text-muted-foreground">Date</Label>
          <input type="hidden" name="incurredOn" value={date} />
          <DatePicker id="ex-date" ariaLabel="Expense date" value={date} onChange={setDate} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ex-method" className="text-xs text-muted-foreground">Method</Label>
          <select id="ex-method" name="method" defaultValue={expense?.method ?? "bank"} className={selectCls}>
            {methodOptions.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ex-vendor" className="text-xs text-muted-foreground">Vendor / payee</Label>
          <Input id="ex-vendor" name="vendor" defaultValue={expense?.vendor ?? ""} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ex-ref" className="text-xs text-muted-foreground">Reference</Label>
          <Input id="ex-ref" name="reference" defaultValue={expense?.reference ?? ""} className="h-8" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ex-note" className="text-xs text-muted-foreground">Note</Label>
          <Input id="ex-note" name="note" defaultValue={expense?.note ?? ""} className="h-8" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : isEdit ? "Save changes" : "Add expense"}</Button>
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input type="checkbox" name="recurring" defaultChecked={!!expense?.recurrence} className="size-4 accent-[var(--color-primary)]" />
          Recurring cost
        </label>
        <select
          name="recurrence"
          defaultValue={expense?.recurrence ?? "monthly"}
          aria-label="Recurrence interval"
          className="h-8 rounded-lg border border-input bg-[var(--input-bg)] px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
        {isEdit && onDone ? (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        ) : null}
      </div>
      <Toast message={state.saved ? (isEdit ? "Expense updated." : "Expense added.") : state.error ?? null} variant={state.error ? "error" : "success"} token={nonce} />
    </form>
  );
}

/** Backwards-compatible alias — the create form on the page. */
export function AddCompanyExpenseForm({ categories }: { categories: { id: string; name: string }[] }) {
  return <CompanyExpenseForm categories={categories} />;
}

/**
 * Recurring templates manager — always shown (a recurring cost is ongoing config, not
 * a dated transaction), so it's never hidden by the period filter. Each row edits
 * inline (reusing CompanyExpenseForm) or deletes.
 */
export function RecurringExpensesManager({
  templates,
  categories,
  canEdit,
  canDelete,
}: {
  templates: (EditableExpense & { categoryName: string | null; nextRunOn: string | null })[];
  categories: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  if (templates.length === 0) {
    return <p className="text-sm text-muted-foreground">No recurring expenses yet. Record one below and tick &ldquo;Recurring cost&rdquo;.</p>;
  }
  return (
    <ul className="space-y-2">
      {templates.map((t) => (
        <li key={t.id} className="rounded-md border p-3">
          {editingId === t.id ? (
            <CompanyExpenseForm categories={categories} expense={t} onDone={() => setEditingId(null)} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium tabular-nums">{rs(t.amount)}</span>
                <span className="ml-1.5 text-muted-foreground">
                  {t.categoryName ?? "Uncategorized"} · {t.recurrence ?? "monthly"}
                  {t.nextRunOn ? ` · next ${t.nextRunOn}` : ""}
                </span>
                {t.vendor || t.note ? (
                  <div className="text-xs text-muted-foreground">{[t.vendor, t.note].filter(Boolean).join(" · ")}</div>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setEditingId(t.id)}
                    className="inline-flex min-h-6 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" /> Edit
                  </button>
                ) : null}
                {canDelete ? <CompanyExpenseRowActions id={t.id} deleted={false} /> : null}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Delete (soft) or restore a company-expense row. */
export function CompanyExpenseRowActions({ id, deleted }: { id: string; deleted: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = (fn: () => Promise<ExpenseActionState>) =>
    start(async () => {
      const r = await fn();
      if (r.error) {
        setErr(r.error);
        setNonce((n) => n + 1);
      }
    });
  return (
    <>
      {deleted ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => restoreCompanyExpenseAction(id))}
          className="inline-flex min-h-6 items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" /> Restore
        </button>
      ) : (
        // Styled confirm dialog (no password — an expense soft-deletes and is restorable).
        <ConfirmDialog
          triggerLabel="Delete"
          triggerIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
          triggerVariant="ghost"
          triggerClassName="h-auto gap-1 px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-destructive"
          title="Delete expense"
          description="This moves the expense to Trash. You can restore it. A recurring template will also stop generating new copies."
          confirmLabel="Delete expense"
          confirmVariant="destructive"
          onConfirm={() => deleteCompanyExpenseAction(id)}
        />
      )}
      <Toast message={err} variant="error" token={nonce} />
    </>
  );
}

/** Add / activate / deactivate company expense categories. */
export function CompanyCategoryManager({ categories }: { categories: { id: string; name: string; isActive: boolean }[] }) {
  const [state, formAction, pending] = useActionState<ExpenseActionState, FormData>(addCompanyCategoryAction, {});
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);
  const [busy, start] = useTransition();

  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="cat-name" className="text-xs text-muted-foreground">New category</Label>
          <Input id="cat-name" name="name" placeholder="e.g. Office" className="h-8 w-48" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>Add</Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => start(async () => { await toggleCompanyCategoryAction(c.id, !c.isActive); })}
              className={`rounded-lg border px-2.5 py-1 text-sm transition-colors disabled:opacity-50 ${
                c.isActive ? "hover:bg-accent" : "opacity-50 line-through hover:opacity-80"
              }`}
              title={c.isActive ? "Deactivate" : "Reactivate"}
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      <Toast message={state.saved ? "Category added." : state.error ?? null} variant={state.error ? "error" : "success"} token={nonce} />
    </div>
  );
}
