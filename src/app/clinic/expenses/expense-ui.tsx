"use client";

import { ActionForm } from "@/core/ui/action-form";
import { useActionState, useState, useTransition } from "react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Dialog } from "@/core/ui/dialog";
import {
  saveExpense,
  deleteExpenseAction,
  restoreExpenseAction,
  addCategoryAction,
  toggleCategoryAction,
  type ExpenseActionState,
} from "./expense-actions";
import { SelectField } from "@/core/ui/select-field";
import { Checkbox } from "@/core/ui/checkbox";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { DatePicker } from "@/core/ui/date-picker";
import { Toast, useActionToast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { useTenderOptions, useVocabularyOptions } from "@/core/ui/vocabulary-provider";

const inputCls =
  "h-9 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const todayStr = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** What an existing expense brings into the form when it is edited. */
export type EditableExpense = {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  amount: number;
  incurredOn: string;
  vendor: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  recurring: boolean;
  recurrence: string | null;
};

/** Record a new expense - or, given `expense`, edit that one (same form, filled in). */
export function AddExpenseForm({
  categories,
  expense,
  onSaved,
}: {
  categories: { id: string; name: string }[];
  expense?: EditableExpense;
  /** Edit mode: called after a successful save (closes the dialog). */
  onSaved?: () => void;
}) {
  // Methods come from the database (ADR-027): active only, in its own order.
  const methodOptions = useTenderOptions();
  // Monthly / Weekly / Yearly — from the database (ADR-027), so the list and its
  // labels are the vocabulary's, not a copy kept in step by hand.
  const recurrenceOptions = useVocabularyOptions("recurrences");
  const isEdit = Boolean(expense);
  const [date, setDate] = useState(expense?.incurredOn ?? todayStr());
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  // Clearing the form is part of adding the expense — the next one is usually
  // typed straight after — so it happens in the action, not in an effect that
  // notices the save afterwards and re-renders to undo the fields.
  const [state, formAction, pending] = useActionState<ExpenseActionState, FormData>(
    async (prev, fd) => {
      const res = await saveExpense(expense?.id ?? null, prev, fd);
      if (res.saved) {
        if (isEdit) onSaved?.();
        else {
          setAmount("");
          setDate(todayStr());
          setCategoryId("");
        }
      }
      return res;
    },
    {},
  );
  useActionToast(state, { saved: isEdit ? "Expense updated." : "Expense added.", error: true });

  const categoryOptions = [
    { value: "", label: "Uncategorized" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
    // An expense filed under a category since switched off still shows it, so an
    // edit does not quietly move it to "Uncategorized".
    ...(expense?.categoryId && !categories.some((c) => c.id === expense.categoryId)
      ? [{ value: expense.categoryId, label: `${expense.categoryName ?? "Category"} (inactive)` }]
      : []),
  ];
  // Distinct field ids per form: an edit dialog can be open while the add form is
  // on the page, and two inputs sharing an id break their labels.
  const idp = isEdit ? `ex-${expense!.id.slice(0, 8)}-` : "ex-";

  return (
    <ActionForm action={formAction} state={state} className="space-y-3">
      {/* Two columns in the Edit dialog (four squeezed the date into Method); four
          across on the page, where there is room. */}
      <div className={isEdit ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
        <SearchableSelect
          label="Category"
          ariaLabel="Expense category"
          name="categoryId"
          value={categoryId}
          onChange={setCategoryId}
          options={categoryOptions}
          placeholder="Category"
          className="h-9 w-full"
        />
        <div className="space-y-1">
          <Label htmlFor={`${idp}amount`} className="text-xs text-muted-foreground">Amount (Rs)</Label>
          <input
            id={`${idp}amount`}
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
          <Label htmlFor={`${idp}date`} className="text-xs text-muted-foreground">Date</Label>
          <input type="hidden" name="incurredOn" value={date} />
          <DatePicker id={`${idp}date`} ariaLabel="Expense date" value={date} onChange={setDate} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}method`} className="text-xs text-muted-foreground">Method</Label>
          <SelectField
            id={`${idp}method`}
            name="method"
            defaultValue={expense?.method ?? "cash"}
            options={[...methodOptions.map((m) => ({ value: m.value, label: m.label }))]}
            ariaLabel="method"
            className="h-9 w-full"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}vendor`} className="text-xs text-muted-foreground">Vendor / payee</Label>
          <Input id={`${idp}vendor`} name="vendor" className="h-9" defaultValue={expense?.vendor ?? ""} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idp}ref`} className="text-xs text-muted-foreground">Reference</Label>
          <Input id={`${idp}ref`} name="reference" className="h-9" defaultValue={expense?.reference ?? ""} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${idp}note`} className="text-xs text-muted-foreground">Note</Label>
          <Input id={`${idp}note`} name="note" className="h-9" defaultValue={expense?.note ?? ""} />
        </div>
      </div>
      {/* Recurring settings, then the save button — at the far right in the dialog,
          where a dialog's primary action is expected. */}
      <div className={isEdit ? "flex flex-wrap items-center justify-between gap-4 pt-1" : "flex flex-wrap items-center gap-4"}>
        {isEdit ? null : (
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add expense"}
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-6 items-center gap-2 text-sm">
            <Checkbox name="recurring" defaultChecked={expense?.recurring ?? false} />
            Recurring cost
          </label>
          <SelectField
            name="recurrence"
            defaultValue={expense?.recurrence ?? "monthly"}
            options={recurrenceOptions}
            ariaLabel="Recurrence interval"
            className="h-9"
          />
        </div>
        {isEdit ? (
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        ) : null}
      </div>
    </ActionForm>
  );
}

/** Edit (the expense form in a dialog), delete (soft) or restore an expense row. */
export function ExpenseRowActions({
  id,
  deleted,
  expense,
  categories,
  canEdit = false,
}: {
  id: string;
  deleted: boolean;
  expense?: EditableExpense;
  categories?: { id: string; name: string }[];
  canEdit?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
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
      {!deleted && canEdit && expense ? (
        <>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" aria-hidden="true" /> Edit
          </Button>
          <Dialog open={editOpen} onOpenChange={setEditOpen} title="Edit expense" className="sm:max-w-3xl">
            {/* Mounted only while open, so it always starts from the row's values. */}
            {editOpen ? (
              <AddExpenseForm categories={categories ?? []} expense={expense} onSaved={() => setEditOpen(false)} />
            ) : null}
          </Dialog>
        </>
      ) : null}
      {deleted ? (
        <Button
          type="button"
          disabled={pending}
          onClick={() => run(() => restoreExpenseAction(id))}
          size="sm" variant="outline"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" /> Restore
        </Button>
      ) : (
        <Button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteExpenseAction(id))}
          size="sm" variant="ghost" className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-3.5" aria-hidden="true" /> Delete
        </Button>
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
  useActionToast(state, { saved: "Category added.", error: true });
  const [busy, start] = useTransition();

  return (
    <div className="space-y-3">
      <ActionForm action={formAction} state={state} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="cat-name" className="text-xs text-muted-foreground">New category</Label>
          <Input id="cat-name" name="name" placeholder="e.g. Equipment" className="h-8 w-48" />
        </div>
        <Button type="submit" size="sm" disabled={pending}>Add</Button>
      </ActionForm>
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
    </div>
  );
}
