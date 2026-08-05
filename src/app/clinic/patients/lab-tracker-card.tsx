"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Badge } from "@/core/ui/badge";
import { Toast } from "@/core/ui/toast";
import {
  deleteLabCaseAction,
  saveLabCaseAction,
  updateLabStatusAction,
} from "./patient-clinical-actions";

export type LabCaseRow = {
  id: string;
  labName: string | null;
  item: string;
  tooth: string | null;
  shade: string | null;
  status: string;
  dueAt: string | null;
  cost: number | null;
  createdAt: string;
};

const money = (n: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);
const selectCls = "h-8 rounded-lg border border-input bg-[var(--input-bg)] pl-2 pr-8 text-sm outline-none select-chevron";
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { sent: "secondary", in_lab: "secondary", received: "default", fitted: "outline", remake: "destructive" };

export function LabTrackerCard({
  cases,
  statuses,
  itemTypes,
  patientId,
  canCreate,
  canEdit,
  canDelete,
}: {
  cases: LabCaseRow[];
  statuses: string[];
  itemTypes: string[];
  patientId: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [item, setItem] = useState(itemTypes[0] ?? "crown");
  const [labName, setLabName] = useState("");
  const [tooth, setTooth] = useState("");
  const [shade, setShade] = useState("");
  const [due, setDue] = useState("");
  const [cost, setCost] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  const run = (fn: () => Promise<{ ok: true } | { error: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      const err = "error" in r ? r.error : undefined;
      setMsg({ text: err ?? okText, error: Boolean(err) });
      setNonce((n) => n + 1);
    });

  const add = () =>
    run(async () => {
      const r = await saveLabCaseAction(patientId, { item, labName: labName || null, tooth: tooth || null, shade: shade || null, dueAt: due || null, cost: cost ? Number(cost) : null });
      if ("ok" in r) { setLabName(""); setTooth(""); setShade(""); setDue(""); setCost(""); }
      return r;
    }, "Lab case added.");

  return (
    <div className="space-y-4">
      {cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lab cases yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {cases.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
              <div className="min-w-0">
                <span className="font-medium capitalize">{c.item}</span>
                {c.tooth ? <span className="text-muted-foreground"> · {c.tooth}</span> : null}
                {c.shade ? <span className="text-muted-foreground"> · shade {c.shade}</span> : null}
                <div className="text-xs text-muted-foreground">
                  {c.labName ? `${c.labName} · ` : ""}sent {c.createdAt}
                  {c.dueAt ? ` · due ${c.dueAt}` : ""}
                  {c.cost != null ? ` · ${money(c.cost)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canEdit ? (
                  <select value={c.status} aria-label="Lab case status" disabled={pending} className={selectCls} onChange={(e) => run(() => updateLabStatusAction(c.id, patientId, e.target.value), "Status updated.")}>
                    {statuses.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                ) : (
                  <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>{c.status.replace("_", " ")}</Badge>
                )}
                {canDelete ? (
                  <button type="button" disabled={pending} aria-label="Remove lab case" onClick={() => run(() => deleteLabCaseAction(c.id, patientId), "Removed.")} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canCreate ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <Field label="Item">
            <select value={item} onChange={(e) => setItem(e.target.value)} className={`${selectCls} capitalize`}>
              {itemTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Lab"><Input value={labName} onChange={(e) => setLabName(e.target.value)} className="h-8 w-32" placeholder="Lab name" /></Field>
          <Field label="Tooth"><Input value={tooth} onChange={(e) => setTooth(e.target.value)} className="h-8 w-16" /></Field>
          <Field label="Shade"><Input value={shade} onChange={(e) => setShade(e.target.value)} className="h-8 w-16" placeholder="A2" /></Field>
          <Field label="Due"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="h-8 w-36" /></Field>
          <Field label="Cost (Rs)"><Input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} className="h-8 w-24" /></Field>
          <Button size="sm" disabled={pending} onClick={add}><Plus className="size-4" /> Send to lab</Button>
        </div>
      ) : null}

      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}

/**
 * A labelled field. The <label> WRAPS its control on purpose: it previously sat as a
 * sibling with no htmlFor, which looks correct on screen but names nothing, so every
 * input in these cards was reaching a screen reader unlabelled. Wrapping gives implicit
 * association without threading ids through every call site.
 *
 * Only for a SINGLE control. Where a caption covers a repeating group (allergies,
 * medications), use a role="group" and label the inputs individually instead: a label
 * wrapping several controls is ambiguous about which one it names.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
