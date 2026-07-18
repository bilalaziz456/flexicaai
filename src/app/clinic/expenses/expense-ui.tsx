"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  saveExpense,
  deleteExpenseAction,
  restoreExpenseAction,
  addCategoryAction,
  toggleCategoryAction,
  type ExpenseActionState,
} from "./expense-actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { DatePicker } from "@/core/ui/date-picker";
import { Toast } from "@/core/ui/toast";

const inputCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const selectCls = `${inputCls} select-chevron pr-8`;

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Record a new expense. */
export function AddExpenseForm({
  categories,
}: {
  categories: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<ExpenseActionState, FormData>(
    saveExpense.bind(null, null),
    {},
  );
  const [nonce, setNonce] = useState(0);
  const [date, setDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (state.saved) {
      setAmount("");
      setDate(todayStr());
    }
    if (state.saved || state.error) setNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="ex-cat" className="text-xs text-muted-foreground">Category</Label>
          <select id="ex-cat" name="categoryId" defaultValue="" className={selectCls}>
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
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
          <select id="ex-method" name="method" defaultValue="cash" className={selectCls}>
            <option value="cash">Cash</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ex-vendor" className="text-xs text-muted-foreground">Vendor / payee</Label>
          <Input id="ex-vendor" name="vendor" className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ex-ref" className="text-xs text-muted-foreground">Reference</Label>
          <Input id="ex-ref" name="reference" className="h-8" />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ex-note" className="text-xs text-muted-foreground">Note</Label>
          <Input id="ex-note" name="note" className="h-8" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add expense"}</Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="recurring" className="size-4 accent-[var(--color-primary)]" />
          Recurring cost
        </label>
        <select
          name="recurrence"
          defaultValue="monthly"
          aria-label="Recurrence interval"
          className="h-8 rounded-lg border border-input bg-[var(--input-bg)] px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      <Toast
        message={state.saved ? "Expense added." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </form>
  );
}

/** Delete (soft) or restore an expense row. */
export function ExpenseRowActions({ id, deleted }: { id: string; deleted: boolean }) {
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
          onClick={() => run(() => restoreExpenseAction(id))}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" /> Restore
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteExpenseAction(id))}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="size-3.5" aria-hidden="true" /> Delete
        </button>
      )}
      <Toast message={err} variant="error" token={nonce} />
    </>
  );
}

/** Add / activate / deactivate expense categories. */
export function CategoryManager({
  categories,
}: {
  categories: { id: string; name: string; isActive: boolean }[];
}) {
  const [state, formAction, pending] = useActionState<ExpenseActionState, FormData>(addCategoryAction, {});
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
          <Input id="cat-name" name="name" placeholder="e.g. Equipment" className="h-8 w-48" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>Add</Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => start(async () => { await toggleCategoryAction(c.id, !c.isActive); })}
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
      <Toast
        message={state.saved ? "Category added." : state.error ?? null}
        variant={state.error ? "error" : "success"}
        token={nonce}
      />
    </div>
  );
}
