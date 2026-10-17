"use client";

import { useState, useTransition } from "react";
import { SelectField } from "@/core/ui/select-field";
import { EmptyState } from "@/core/ui/empty-state";
import { Plus, Trash2, ClipboardList, Pencil, FileText, Printer } from "lucide-react";
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
  updatePlanTermsAction,
} from "./treatment-plan-actions";
import { computePlanBill, discountByLabel, type PlanBearer } from "@/core/patients/plan-bill";
import { MAX_DISCOUNT_PERCENT, type DiscountType } from "@/core/appointments/fee";
import { describeOfferAmount, offerLabel } from "@/core/appointments/procedure-offer";
import {
  TREATMENT_ITEM_STATUS_ROWS,
  TREATMENT_PLAN_STATUS_ROWS,
} from "@/core/db/vocabulary-seed";

export type PlanItemRow = {
  id: string;
  name: string;
  tooth: string | null;
  quantity: number;
  unitPrice: number;
  status: string;
  /** The clinic offer snapshotted when the item was added (0 = none). */
  offerType: DiscountType;
  offerValue: number;
  /** The item's own plan discount. */
  discountType: DiscountType;
  discountValue: number;
};
export type PlanRow = {
  id: string;
  title: string;
  status: string;
  note: string | null;
  doctorId: string | null;
  /** The overall discount, and who gives the plan's discounts. */
  discountType: DiscountType;
  discountValue: number;
  borneBy: PlanBearer;
  splitType: DiscountType;
  splitValue: number;
  items: PlanItemRow[];
};
type Proc = { id: string; name: string; price: number };
type Option = { value: string; label: string };

const money = (n: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);
const PLAN_STATUSES = TREATMENT_PLAN_STATUS_ROWS.map((r) => r.code);
const ITEM_STATUSES = TREATMENT_ITEM_STATUS_ROWS.map((r) => r.code);
const PLAN_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { proposed: "secondary", active: "default", completed: "outline", cancelled: "destructive" };


export function TreatmentPlansCard({
  plans,
  procedures,
  doctors = [],
  clinicName = null,
  templates,
  patientId,
  estimateBase,
  canCreate,
  canEdit,
  canDelete,
}: {
  plans: PlanRow[];
  procedures: Proc[];
  /** The clinic's doctors, for the plan's optional doctor. */
  doctors?: Option[];
  /** Names the clinic's offer and a clinic discount ("Smile Dental offer"). */
  clinicName?: string | null;
  templates: string[];
  patientId: string;
  /** Base path for a plan's printable estimate, e.g. "/clinic/patients/{id}/estimate". */
  estimateBase?: string;
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
  const [editingTerms, setEditingTerms] = useState<string | null>(null);
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
            const bill = computePlanBill(
              p.items.map((i) => ({ ...i, cancelled: i.status === "cancelled" })),
              { type: p.discountType, value: p.discountValue },
            );
            const doctorName = doctors.find((d) => d.value === p.doctorId)?.label ?? null;
            const discountBy = discountByLabel(p.borneBy, doctorName, clinicName);
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
                    <DownloadLink href={`${estimateBase}/${p.id}`} label="Download" className="gap-1 text-xs" />
                    {/* On the clinic's letterhead, like a typed prescription — and the
                        same two papers: plain (letterhead printed too) or pre-printed. */}
                    <a
                      href={`/api/estimate/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                      title="For plain white paper: the clinic letterhead is printed with the estimate"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <FileText className="size-3.5" aria-hidden="true" /> Print with letterhead
                    </a>
                    <a
                      href={`/api/estimate/${p.id}?pad=1`}
                      target="_blank"
                      rel="noreferrer"
                      title="For paper that already has your letterhead printed on it: only the estimate is printed, in the right place"
                      className="inline-flex items-center gap-1 text-foreground hover:underline"
                    >
                      <Printer className="size-3.5" aria-hidden="true" /> Print without letterhead
                    </a>
                  </div>
                ) : null}

                {p.items.length > 0 ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {p.items.map((it, idx) =>
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
                            {bill.items[idx].offer > 0 ? (
                              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                                {offerLabel(clinicName)}: {describeOfferAmount(it.offerType, it.offerValue)} (−{money(bill.items[idx].offer)})
                                {canEdit ? (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => run(() => updatePlanItemAction(it.id, patientId, { removeOffer: true }), "Offer removed.")}
                                    className="text-destructive-text underline-offset-2 hover:underline"
                                  >
                                    Remove offer
                                  </button>
                                ) : null}
                              </span>
                            ) : null}
                            {bill.items[idx].discount > 0 ? (
                              <span className="block text-xs text-muted-foreground">
                                Discount: {describeOfferAmount(it.discountType, it.discountValue)} (−{money(bill.items[idx].discount)})
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1 text-center text-muted-foreground">×{it.quantity}</td>
                          <td className="py-1 text-right tabular-nums">
                            {bill.items[idx].net !== bill.items[idx].gross ? (
                              <span className="block text-xs text-muted-foreground line-through">{money(bill.items[idx].gross)}</span>
                            ) : null}
                            {money(it.status === "cancelled" ? it.unitPrice * it.quantity : bill.items[idx].net)}
                          </td>
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

                <PlanTotals bill={bill} discountBy={discountBy} offerName={offerLabel(clinicName)} />

                {editingTerms === p.id ? (
                  <TermsForm
                    plan={p}
                    doctors={doctors}
                    pending={pending}
                    onCancel={() => setEditingTerms(null)}
                    onSave={(terms) =>
                      run(async () => {
                        const r = await updatePlanTermsAction(p.id, patientId, terms);
                        if (r.ok) setEditingTerms(null);
                        return r;
                      }, "Plan discount saved.")
                    }
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Doctor: {doctorName ?? "—"}</span>
                    {bill.planDiscount > 0 ? <span>Discount by {discountBy}</span> : null}
                    {canEdit ? (
                      <Button size="xs" variant="outline" disabled={pending} onClick={() => setEditingTerms(p.id)}>
                        <Pencil className="size-3" aria-hidden="true" /> Doctor &amp; discount
                      </Button>
                    ) : null}
                  </div>
                )}

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

/** Change one item's teeth, quantity, price or discount, in place. */
function EditItemForm({
  item,
  pending,
  onSave,
  onCancel,
}: {
  item: PlanItemRow;
  pending: boolean;
  onSave: (patch: {
    tooth: string | null;
    quantity: number;
    unitPrice: number;
    discount: { type: DiscountType; value: number };
  }) => void;
  onCancel: () => void;
}) {
  const [tooth, setTooth] = useState(item.tooth ?? "");
  const [qty, setQty] = useState(String(item.quantity));
  const [price, setPrice] = useState(String(item.unitPrice));
  const [discountType, setDiscountType] = useState<DiscountType>(item.discountType);
  const [discountValue, setDiscountValue] = useState(item.discountValue ? String(item.discountValue) : "");
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
      <DiscountInput label="Discount" type={discountType} value={discountValue} onType={setDiscountType} onValue={setDiscountValue} />
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          onSave({
            tooth: tooth.trim() || null,
            quantity: Number(qty) || 1,
            unitPrice: Number(price) || 0,
            discount: { type: discountType, value: Number(discountValue) || 0 },
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/** Subtotal → offers → discounts → total, showing only the lines that apply. */
function PlanTotals({
  bill,
  discountBy,
  offerName,
}: {
  bill: ReturnType<typeof computePlanBill>;
  discountBy: string;
  offerName: string;
}) {
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between gap-3">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "font-medium" : ""}`}>{value}</span>
    </div>
  );
  const discounted = bill.offers > 0 || bill.planDiscount > 0;
  return (
    <div className="space-y-0.5 text-sm">
      {discounted ? row("Subtotal", money(bill.gross)) : null}
      {bill.offers > 0 ? row(offerName, `−${money(bill.offers)}`) : null}
      {bill.itemDiscounts > 0 ? row(`Treatment discounts (by ${discountBy})`, `−${money(bill.itemDiscounts)}`) : null}
      {bill.overallDiscount > 0 ? row(`Overall discount (by ${discountBy})`, `−${money(bill.overallDiscount)}`) : null}
      {row("Total", money(bill.total), true)}
    </div>
  );
}

/** A discount: amount or percentage, and its figure. */
function DiscountInput({
  label,
  type,
  value,
  onType,
  onValue,
}: {
  label: string;
  type: DiscountType;
  value: string;
  onType: (t: DiscountType) => void;
  onValue: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        <SelectField
          value={type}
          onValueChange={(v) => onType(v === "percent" ? "percent" : "amount")}
          options={[
            { value: "amount", label: "Rs" },
            { value: "percent", label: "%" },
          ]}
          ariaLabel={`${label} type`}
          className="h-8 w-16"
        />
        <Input
          value={value}
          inputMode="numeric"
          aria-label={label}
          placeholder="0"
          onChange={(e) => {
            const digits = e.target.value.replace(/[^\d]/g, "");
            // A percentage over 100 is a typo, never a bigger discount (ADR-021).
            onValue(type === "percent" && digits ? String(Math.min(Number(digits), MAX_DISCOUNT_PERCENT)) : digits);
          }}
          className="h-8 w-24"
        />
      </div>
    </div>
  );
}

const BEARERS: { value: PlanBearer; label: string }[] = [
  { value: "clinic", label: "Clinic" },
  { value: "doctor", label: "Doctor" },
  { value: "split", label: "Both" },
];

/**
 * The plan's doctor and discount: the overall discount, and who gives the plan's
 * discounts — chosen ONCE for the plan, covering each treatment's discount too. No
 * approval: the plan is the agreement with the patient (owner's call, 2026-10-18).
 */
function TermsForm({
  plan,
  doctors,
  pending,
  onSave,
  onCancel,
}: {
  plan: PlanRow;
  doctors: Option[];
  pending: boolean;
  onSave: (terms: {
    doctorId: string | null;
    discountType: DiscountType;
    discountValue: number;
    borneBy: PlanBearer;
    splitType: DiscountType;
    splitValue: number;
  }) => void;
  onCancel: () => void;
}) {
  const [doctorId, setDoctorId] = useState(plan.doctorId ?? "");
  const [type, setType] = useState<DiscountType>(plan.discountType);
  const [value, setValue] = useState(plan.discountValue ? String(plan.discountValue) : "");
  const [borneBy, setBorneBy] = useState<PlanBearer>(plan.borneBy);
  const [splitType, setSplitType] = useState<DiscountType>(plan.splitType);
  const [splitValue, setSplitValue] = useState(plan.splitValue ? String(plan.splitValue) : "");
  const needsDoctor = borneBy !== "clinic" && !doctorId;
  return (
    <div className="space-y-3 rounded-md border well p-2.5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <span className="block text-xs text-muted-foreground">Doctor (optional)</span>
          <SearchableSelect
            ariaLabel="Plan doctor"
            value={doctorId}
            onChange={setDoctorId}
            options={[{ value: "", label: "None" }, ...doctors]}
            placeholder="None"
            searchPlaceholder="Search doctors…"
            className="h-8 w-48"
          />
        </div>
        <DiscountInput label="Overall discount" type={type} value={value} onType={setType} onValue={setValue} />
      </div>
      <div className="space-y-1">
        <span className="block text-xs text-muted-foreground">Discount by</span>
        <div className="flex flex-wrap items-end gap-2" role="radiogroup" aria-label="Discount by">
          {BEARERS.map((b) => (
            <Button
              key={b.value}
              type="button"
              size="sm"
              role="radio"
              aria-checked={borneBy === b.value}
              variant={borneBy === b.value ? "default" : "outline"}
              onClick={() => setBorneBy(b.value)}
            >
              {b.label}
            </Button>
          ))}
          {borneBy === "split" ? (
            <DiscountInput label="Doctor's part" type={splitType} value={splitValue} onType={setSplitType} onValue={setSplitValue} />
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Covers each treatment&apos;s discount and the overall one. It comes out of that side&apos;s share when the
          visit is billed, and needs no approval.
        </p>
        {needsDoctor ? <p className="text-xs text-destructive-text">Choose the doctor giving the discount.</p> : null}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || needsDoctor}
          onClick={() =>
            onSave({
              doctorId: doctorId || null,
              discountType: type,
              discountValue: Number(value) || 0,
              borneBy,
              splitType,
              splitValue: Number(splitValue) || 0,
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
