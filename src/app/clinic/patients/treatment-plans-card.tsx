"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Badge } from "@/core/ui/badge";
import { Toast } from "@/core/ui/toast";
import {
  addPlanItemAction,
  createPlanAction,
  createPlanFromTemplateAction,
  deletePlanAction,
  deletePlanItemAction,
  setPlanStatusAction,
  updatePlanItemAction,
} from "./treatment-plan-actions";

export type PlanItemRow = { id: string; name: string; tooth: string | null; quantity: number; unitPrice: number; status: string };
export type PlanRow = { id: string; title: string; status: string; note: string | null; items: PlanItemRow[] };
type Proc = { id: string; name: string; price: number };

const money = (n: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);
const PLAN_STATUSES = ["proposed", "active", "completed", "cancelled"];
const ITEM_STATUSES = ["planned", "in_progress", "done", "cancelled"];
const PLAN_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { proposed: "secondary", active: "default", completed: "outline", cancelled: "destructive" };

const selectCls = "h-8 rounded-lg border border-input bg-[var(--input-bg)] px-2 text-sm outline-none";

export function TreatmentPlansCard({
  plans,
  procedures,
  templates,
  patientId,
  canCreate,
  canEdit,
  canDelete,
}: {
  plans: PlanRow[];
  procedures: Proc[];
  templates: string[];
  patientId: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [title, setTitle] = useState("");
  const [tmpl, setTmpl] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = (fn: () => Promise<{ ok?: true; error?: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      setMsg({ text: r.error ?? okText, error: Boolean(r.error) });
      setNonce((n) => n + 1);
    });

  return (
    <div className="space-y-4">
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">No treatment plans yet.</p>
      ) : (
        <ul className="space-y-4">
          {plans.map((p) => {
            const total = p.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
            return (
              <li key={p.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.title}</span>
                  <div className="flex items-center gap-2">
                    {canEdit ? (
                      <select value={p.status} disabled={pending} className={selectCls} onChange={(e) => run(() => setPlanStatusAction(p.id, patientId, e.target.value), "Plan updated.")}>
                        {PLAN_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                      </select>
                    ) : (
                      <Badge variant={PLAN_VARIANT[p.status] ?? "secondary"}>{p.status}</Badge>
                    )}
                    {canDelete ? (
                      <button type="button" disabled={pending} aria-label="Delete plan" onClick={() => run(() => deletePlanAction(p.id, patientId), "Plan deleted.")} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </div>

                {p.items.length > 0 ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {p.items.map((it) => (
                        <tr key={it.id} className="border-b last:border-0">
                          <td className="py-1">{it.name}{it.tooth ? <span className="text-muted-foreground"> · {it.tooth}</span> : null}</td>
                          <td className="py-1 text-center text-muted-foreground">×{it.quantity}</td>
                          <td className="py-1 text-right tabular-nums">{money(it.unitPrice * it.quantity)}</td>
                          <td className="py-1 pl-2">
                            {canEdit ? (
                              <select value={it.status} disabled={pending} className={`${selectCls} h-7`} onChange={(e) => run(() => updatePlanItemAction(it.id, patientId, { status: e.target.value }), "Item updated.")}>
                                {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                              </select>
                            ) : (
                              <Badge variant="outline">{it.status.replace("_", " ")}</Badge>
                            )}
                          </td>
                          <td className="py-1 pl-1">
                            {canEdit ? (
                              <button type="button" disabled={pending} aria-label="Remove item" onClick={() => run(() => deletePlanItemAction(it.id, patientId), "Removed.")} className="text-muted-foreground hover:text-destructive">
                                <Trash2 className="size-3.5" />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
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
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">New plan</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Plan title" className="h-8 w-48" />
          </div>
          <Button size="sm" disabled={pending || !title.trim()} onClick={() => run(async () => { const r = await createPlanAction(patientId, title); if (r.ok) setTitle(""); return r; }, "Plan created.")}>
            <Plus className="size-4" /> Create
          </Button>
          {templates.length > 0 ? (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From template</label>
                <select value={tmpl} onChange={(e) => setTmpl(e.target.value)} className={`${selectCls} w-48`}>
                  <option value="">Choose…</option>
                  {templates.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
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
  const add = () => {
    const proc = procedures.find((p) => p.id === procId);
    if (!proc) return;
    onRun(() => addPlanItemAction(planId, patientId, { procedureId: proc.id, name: proc.name, unitPrice: proc.price, tooth: tooth || null, quantity: Number(qty) || 1 }), "Item added.");
    setProcId(""); setTooth(""); setQty("1");
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <select value={procId} onChange={(e) => setProcId(e.target.value)} className={`${selectCls} h-7 max-w-52`}>
        <option value="">Add procedure…</option>
        {procedures.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <Input value={tooth} onChange={(e) => setTooth(e.target.value)} placeholder="Tooth" className="h-7 w-16" />
      <Input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))} className="h-7 w-12" />
      <Button size="sm" variant="outline" disabled={pending || !procId} onClick={add}>Add</Button>
    </div>
  );
}
