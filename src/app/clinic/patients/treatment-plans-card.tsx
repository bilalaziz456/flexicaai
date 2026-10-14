"use client";

import { useState, useTransition } from "react";
import { SelectField } from "@/core/ui/select-field";
import { EmptyState } from "@/core/ui/empty-state";
import { Plus, Trash2, ClipboardList, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { DownloadLink } from "@/core/ui/download-link";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Badge } from "@/core/ui/badge";
import { Toast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";
import {
  addPlanItemAction,
  createPlanAction,
  createPlanFromTemplateAction,
  deletePlanAction,
  deletePlanItemAction,
  setPlanStatusAction,
  updatePlanAction,
  updatePlanItemAction,
} from "./treatment-plan-actions";
import {
  TREATMENT_ITEM_STATUS_ROWS,
  TREATMENT_PLAN_STATUS_ROWS,
} from "@/core/db/vocabulary-seed";
import { PrintLinks } from "@/core/ui/print-links";

export type PlanItemRow = { id: string; name: string; tooth: string | null; quantity: number; unitPrice: number; status: string };
export type PlanRow = { id: string; title: string; status: string; note: string | null; items: PlanItemRow[] };
type Proc = { id: string; name: string; price: number };

const money = (n: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);
const PLAN_STATUSES = TREATMENT_PLAN_STATUS_ROWS.map((r) => r.code);
const ITEM_STATUSES = TREATMENT_ITEM_STATUS_ROWS.map((r) => r.code);
const PLAN_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { proposed: "secondary", active: "default", completed: "outline", cancelled: "destructive" };


export function TreatmentPlansCard({
  plans,
  procedures,
  templates,
  patientId,
  estimateBase,
  papers = ["a4"],
  canCreate,
  canEdit,
  canDelete,
}: {
  plans: PlanRow[];
  procedures: Proc[];
  templates: string[];
  patientId: string;
  /** Base path for a plan's printable estimate, e.g. "/clinic/patients/{id}/estimate". */
  estimateBase?: string;
  /** Paper sizes the clinic prints on (one Print button each). */
  papers?: string[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [title, setTitle] = useState("");
  const [tmpl, setTmpl] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  // One plan and one item can be in edit mode at a time.
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok?: true; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg({ text: r.error ?? okText, error: Boolean(r.error) });
      setNonce((n) => n + 1);
    });

  return (
    <div className="space-y-4">
      {plans.length === 0 ? (
        <EmptyState
                  compact
                  icon={ClipboardList}
                  title="No treatment plans yet"
                  description="A plan groups the procedures a patient has agreed to, with an estimate."
                />
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {plans.map((p) => {
            const total = p.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
            return (
              <li key={p.id} className="space-y-2 p-3">
                {editingPlan === p.id ? (
                  <EditPlanForm
                    plan={p}
                    pending={pending}
                    onCancel={() => setEditingPlan(null)}
                    onSave={(title, note) =>
                      run(async () => {
                        const r = await updatePlanAction(p.id, patientId, title, note);
                        if (r.ok) setEditingPlan(null);
                        return r;
                      }, "Plan updated.")
                    }
                  />
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {editingPlan === p.id ? (
                    <span />
                  ) : (
                    <div className="min-w-0">
                      <span className="font-medium">{p.title}</span>
                      {p.note ? <p className="text-xs text-muted-foreground">{p.note}</p> : null}
                    </div>
                  )}
                  {/* Two rows (owner's report): the plan's own controls here, the estimate's
                      Print / Download on a row of their own below — in one row the status
                      dropdown took every spare pixel and stacked the print buttons. */}
                  <div className="flex shrink-0 items-center gap-2">
                    {canEdit && editingPlan !== p.id ? (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditingPlan(p.id)}>
                        <Pencil className="size-3.5" aria-hidden="true" /> Edit
                        <span className="sr-only"> plan {p.title}</span>
                      </Button>
                    ) : null}
                    {canEdit ? (
                      <SelectField
                        value={p.status}
                        onValueChange={(next) => run(() => setPlanStatusAction(p.id, patientId, next), "Plan updated.")}
                        disabled={pending}
                        options={[...PLAN_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))]}
                        ariaLabel={`Status of ${p.title}`}
                        className="h-8 w-36 capitalize"
                      />
                    ) : (
                      <Badge variant={PLAN_VARIANT[p.status] ?? "secondary"}>{p.status}</Badge>
                    )}
                    {canDelete ? (
                      <ConfirmDialog
                        triggerLabel={`Delete plan ${p.title}`}
                        triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
                        triggerVariant="ghost"
                        triggerClassName="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text [&>span]:hidden"
                        triggerDisabled={pending}
                        title="Delete this treatment plan?"
                        description={`"${p.title}" and its ${p.items.length} item${p.items.length === 1 ? "" : "s"} will move to Trash. You can restore it from Trash.`}
                        confirmLabel="Delete plan"
                        confirmVariant="destructive"
                        onConfirm={async () => {
                          const r = await deletePlanAction(p.id, patientId);
                          if (r.error) return { error: r.error };
                          setMsg({ text: "Plan moved to Trash.", error: false });
                          setNonce((n) => n + 1);
                        }}
                      />
                    ) : null}
                  </div>
                </div>

                {estimateBase && p.items.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Estimate:</span>
                    <PrintLinks href={`${estimateBase}/${p.id}`} papers={papers} single="Print" className="gap-1 text-xs" />
                    <DownloadLink href={`${estimateBase}/${p.id}`} label="Download" className="gap-1 text-xs" />
                  </div>
                ) : null}

                {p.items.length > 0 ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {p.items.map((it) =>
                        editingItem === it.id ? (
                          <tr key={it.id} className="border-b last:border-0">
                            <td colSpan={5} className="py-1.5">
                              <EditItemForm
                                item={it}
                                pending={pending}
                                onCancel={() => setEditingItem(null)}
                                onSave={(patch) =>
                                  run(async () => {
                                    const r = await updatePlanItemAction(it.id, patientId, patch);
                                    if (r.ok) setEditingItem(null);
                                    return r;
                                  }, "Item updated.")
                                }
                              />
                            </td>
                          </tr>
                        ) : (
                        <tr key={it.id} className="border-b last:border-0">
                          <td className="py-1">
                            {it.name}
                            {it.tooth ? (
                              <span className="text-muted-foreground"> · {it.tooth.includes(",") ? "teeth" : "tooth"} {it.tooth}</span>
                            ) : null}
                          </td>
                          <td className="py-1 text-center text-muted-foreground">×{it.quantity}</td>
                          <td className="py-1 text-right tabular-nums">{money(it.unitPrice * it.quantity)}</td>
                          <td className="py-1 pl-2">
                            {canEdit ? (
                              <SelectField
                                value={it.status}
                                onValueChange={(next) => run(() => updatePlanItemAction(it.id, patientId, { status: next }), "Item updated.")}
                                disabled={pending}
                                options={[...ITEM_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))]}
                                ariaLabel={`Status of ${it.name}`}
                                className="h-7 w-32 capitalize"
                              />
                            ) : (
                              <Badge variant="outline">{it.status.replace("_", " ")}</Badge>
                            )}
                          </td>
                          <td className="py-1 pl-1">
                            {canEdit ? (
                              <span className="flex items-center">
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={pending}
                                  aria-label={`Edit ${it.name}`}
                                  onClick={() => setEditingItem(it.id)}
                                >
                                  <Pencil className="size-3.5" aria-hidden="true" />
                                </Button>
                                <ConfirmDialog
                                  triggerLabel={`Remove ${it.name}`}
                                  triggerIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                                  triggerVariant="ghost"
                                  triggerClassName="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text [&>span]:hidden"
                                  triggerDisabled={pending}
                                  title="Remove this item?"
                                  description={`"${it.name}${it.tooth ? ` (${it.tooth})` : ""}" will be taken off "${p.title}" and the estimate. This can't be undone — add it again if needed.`}
                                  confirmLabel="Remove"
                                  confirmVariant="destructive"
                                  onConfirm={async () => {
                                    const r = await deletePlanItemAction(it.id, patientId);
                                    if (r.error) return { error: r.error };
                                    setMsg({ text: "Item removed.", error: false });
                                    setNonce((n) => n + 1);
                                  }}
                                />
                              </span>
                            ) : null}
                          </td>
                        </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                ) : <p className="text-xs text-muted-foreground">No items yet.</p>}

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium tabular-nums">{money(total)}</span>
                </div>

                {canEdit ? <AddItem planId={p.id} patientId={patientId} procedures={procedures} pending={pending} onRun={run} /> : null}
              </li>
            );
          })}
        </ul>
      )}

      {canCreate ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 bg-surface-sunken p-3.5">
          {/* label WRAPS the input: as a sibling with no htmlFor it named nothing. */}
          <label className="block space-y-1">
            <span className="block text-xs text-muted-foreground">New plan</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Plan title" className="h-8 w-48" />
          </label>
          <Button size="sm" disabled={pending || !title.trim()} onClick={() => run(async () => { const r = await createPlanAction(patientId, title); if (r.ok) setTitle(""); return r; }, "Plan created.")}>
            <Plus className="size-4" /> Create
          </Button>
          {templates.length > 0 ? (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From template</label>
                <SearchableSelect
                  ariaLabel="Treatment template"
                  value={tmpl}
                  onChange={setTmpl}
                  options={[{ value: "", label: "Choose…" }, ...templates.map((t) => ({ value: t, label: t }))]}
                  placeholder="Choose…"
                  className="h-8 w-48"
                />
              </div>
              <Button size="sm" variant="outline" disabled={pending || !tmpl} onClick={() => run(async () => { const r = await createPlanFromTemplateAction(patientId, tmpl); if (r.ok) setTmpl(""); return r; }, "Plan created.")}>
                Add
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}

function AddItem({ planId, patientId, procedures, pending, onRun }: { planId: string; patientId: string; procedures: Proc[]; pending: boolean; onRun: (fn: () => Promise<{ ok?: true; error?: string }>, ok: string) => void }) {
  const [procId, setProcId] = useState("");
  const [tooth, setTooth] = useState("");
  const [qty, setQty] = useState("1");
  // Quantity follows the number of teeth typed (a crown on 47, 48, 53 is three
  // crowns) until somebody types a quantity themselves.
  const [qtyTouched, setQtyTouched] = useState(false);
  const toothCount = tooth.split(/[\s,;/]+/).filter(Boolean).length;
  const add = () => {
    const proc = procedures.find((p) => p.id === procId);
    if (!proc) return;
    onRun(async () => {
      const r = await addPlanItemAction(planId, patientId, { procedureId: proc.id, name: proc.name, unitPrice: proc.price, tooth: tooth || null, quantity: Number(qty) || 1 });
      // Keep what was typed when the save is refused (a wrong tooth number), so it can be fixed.
      if (r.ok) { setProcId(""); setTooth(""); setQty("1"); setQtyTouched(false); }
      return r;
    }, "Item added.");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <SearchableSelect
        ariaLabel="Add procedure"
        value={procId}
        onChange={setProcId}
        options={[{ value: "", label: "Add procedure…" }, ...procedures.map((p) => ({ value: p.id, label: p.name }))]}
        placeholder="Add procedure…"
        className="h-8 w-52"
      />
      <Input
        value={tooth}
        onChange={(e) => {
          const next = e.target.value;
          setTooth(next);
          if (!qtyTouched) setQty(String(Math.max(1, next.split(/[\s,;/]+/).filter(Boolean).length)));
        }}
        aria-label="Tooth or teeth"
        placeholder="Teeth: 47, 48, 53"
        maxLength={150}
        className="h-7 w-36"
      />
      <Input
        aria-label="Quantity"
        title={toothCount > 1 && !qtyTouched ? "One per tooth — change it if needed" : undefined}
        value={qty}
        onChange={(e) => { setQtyTouched(true); setQty(e.target.value.replace(/[^\d]/g, "")); }}
        className="h-7 w-12"
      />
      <Button size="sm" variant="outline" disabled={pending || !procId} onClick={add}>Add</Button>
    </div>
  );
}

/** How many teeth a typed list names ("47, 42 46" → 3). */
function countTeeth(list: string): number {
  return list.split(/[\s,;/]+/).filter(Boolean).length;
}

/** Rename a plan and change its note, in place. */
function EditPlanForm({
  plan,
  pending,
  onSave,
  onCancel,
}: {
  plan: PlanRow;
  pending: boolean;
  onSave: (title: string, note: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(plan.title);
  const [note, setNote] = useState(plan.note ?? "");
  return (
    <div className="space-y-2 rounded-md border well p-2.5">
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">Plan title</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-8" />
      </label>
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">Note (optional, printed on the estimate)</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="h-8" />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !title.trim()} onClick={() => onSave(title, note)}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** Change one item's teeth, quantity or price, in place. */
function EditItemForm({
  item,
  pending,
  onSave,
  onCancel,
}: {
  item: PlanItemRow;
  pending: boolean;
  onSave: (patch: { tooth: string | null; quantity: number; unitPrice: number }) => void;
  onCancel: () => void;
}) {
  const [tooth, setTooth] = useState(item.tooth ?? "");
  const [qty, setQty] = useState(String(item.quantity));
  const [price, setPrice] = useState(String(item.unitPrice));
  // Quantity follows the teeth while the two are in step — removing 42 from
  // "47, 42, 46" at quantity 3 makes it 2 (owner's report). A quantity somebody set
  // on purpose (2 sittings for one tooth) no longer matches the count, so it is kept.
  const changeTeeth = (next: string) => {
    if (Number(qty) === countTeeth(tooth) || !qty) setQty(String(Math.max(1, countTeeth(next))));
    setTooth(next);
  };
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border well p-2.5">
      <span className="w-full text-xs font-medium">{item.name}</span>
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">Teeth</span>
        <Input value={tooth} onChange={(e) => changeTeeth(e.target.value)} placeholder="47, 48, 53" maxLength={150} className="h-8 w-36" />
      </label>
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">Qty</span>
        <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} className="h-8 w-14" />
      </label>
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">Price each (Rs)</span>
        <Input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))} className="h-8 w-24" />
      </label>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => onSave({ tooth: tooth.trim() || null, quantity: Number(qty) || 1, unitPrice: Number(price) || 0 })}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={onCancel}>Cancel</Button>
    </div>
  );
}
