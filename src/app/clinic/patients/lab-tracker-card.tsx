"use client";

import { useState, useTransition } from "react";
import { SelectField } from "@/core/ui/select-field";
import { EmptyState } from "@/core/ui/empty-state";
import { Plus, Trash2, FlaskConical, Phone, Pencil } from "lucide-react";
import { PHONE_ERROR, PHONE_PATTERN, PHONE_PLACEHOLDER, sanitisePhoneInput, toE164 } from "@/core/lib/phone";
import { Button } from "@/core/ui/button";
import { DatePicker, DATE_FIELD_W } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Badge } from "@/core/ui/badge";
import { Toast } from "@/core/ui/toast";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import type { LabCaseInput } from "@/core/types/module";
import {
  deleteLabCaseAction,
  saveLabCaseAction,
  updateLabCaseAction,
  updateLabStatusAction,
} from "./patient-clinical-actions";

export type LabCaseRow = {
  id: string;
  labName: string | null;
  labContactName: string | null;
  labContactPhone: string | null;
  item: string;
  tooth: string | null;
  shade: string | null;
  status: string;
  dueAt: string | null;
  /** The due date as YYYY-MM-DD, for the Edit form ("" = none). */
  dueYmd: string;
  cost: number | null;
  note: string | null;
  createdAt: string;
};

type Result = { ok: true } | { error: string };

const money = (n: number) => new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(n);
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
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);
  // One case can be in edit mode at a time.
  const [editing, setEditing] = useState<string | null>(null);
  // Resolves to the result so a form can keep what was typed when the save is refused.
  const run = (fn: () => Promise<Result>, okText: string) =>
    new Promise<Result>((resolve) =>
      start(async () => {
        const r = await fn();
        const err = "error" in r ? r.error : undefined;
        setMsg({ text: err ?? okText, error: Boolean(err) });
        setNonce((n) => n + 1);
        resolve(r);
      }),
    );

  return (
    <div className="space-y-4">
      {cases.length === 0 ? (
        <EmptyState
                  compact
                  icon={FlaskConical}
                  title="No lab cases yet"
                  description="Crowns, dentures and other lab work sent out for this patient are tracked here."
                />
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 text-sm">
          {cases.map((c) =>
            editing === c.id ? (
              <li key={c.id} className="p-2.5">
                <LabCaseForm
                  itemTypes={itemTypes}
                  initial={c}
                  pending={pending}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (input) => {
                    const r = await run(() => updateLabCaseAction(c.id, patientId, input), "Lab case updated.");
                    if ("ok" in r) setEditing(null);
                    return r;
                  }}
                />
              </li>
            ) : (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
              <div className="min-w-0">
                <span className="font-medium capitalize">{c.item}</span>
                {c.tooth ? (
                  <span className="text-muted-foreground"> · {c.tooth.includes(",") ? "teeth" : "tooth"} {c.tooth}</span>
                ) : null}
                {c.shade ? <span className="text-muted-foreground"> · shade {c.shade}</span> : null}
                <div className="text-xs text-muted-foreground">
                  {c.labName ? `${c.labName} · ` : ""}sent {c.createdAt}
                  {c.dueAt ? ` · due ${c.dueAt}` : ""}
                  {c.cost != null ? ` · ${money(c.cost)}` : ""}
                </div>
                {c.labContactName || c.labContactPhone ? (
                  <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span>Lab contact:</span>
                    {c.labContactName ? <span className="text-foreground">{c.labContactName}</span> : null}
                    {c.labContactPhone ? (
                      <a href={`tel:${c.labContactPhone}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Phone className="size-3" aria-hidden="true" />
                        {c.labContactPhone}
                      </a>
                    ) : null}
                  </div>
                ) : null}
                {c.note ? <div className="text-xs text-muted-foreground">{c.note}</div> : null}
              </div>
              <div className="flex items-center gap-2">
                {canEdit ? (
                  <SelectField
                    value={c.status}
                    onValueChange={(next) => run(() => updateLabStatusAction(c.id, patientId, next), "Status updated.")}
                    disabled={pending}
                    options={[...statuses.map((s) => ({ value: s, label: s.replace("_", " ") }))]}
                    ariaLabel="Lab case status"
                    className="h-8 w-full"
                  />
                ) : (
                  <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>{c.status.replace("_", " ")}</Badge>
                )}
                {canEdit ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Edit lab case ${c.item}`}
                    onClick={() => setEditing(c.id)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
                {canDelete ? (
                  <ConfirmDialog
                    triggerLabel={`Delete lab case ${c.item}`}
                    triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
                    triggerVariant="ghost"
                    triggerClassName="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text [&>span]:hidden"
                    triggerDisabled={pending}
                    title="Delete this lab case?"
                    description={`The ${c.item}${c.tooth ? ` for ${c.tooth}` : ""}${c.labName ? ` at ${c.labName}` : ""} will move to Trash. You can restore it from Trash.`}
                    confirmLabel="Delete"
                    confirmVariant="destructive"
                    onConfirm={async () => {
                      const r = await deleteLabCaseAction(c.id, patientId);
                      if ("error" in r) return { error: r.error };
                      setMsg({ text: "Lab case moved to Trash.", error: false });
                      setNonce((n) => n + 1);
                    }}
                  />
                ) : null}
              </div>
            </li>
            ),
          )}
        </ul>
      )}

      {canCreate ? (
        <LabCaseForm
          itemTypes={itemTypes}
          pending={pending}
          submitLabel="Send to lab"
          onSubmit={(input) => run(() => saveLabCaseAction(patientId, input), "Lab case added.")}
        />
      ) : null}

      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}

/**
 * A lab case's fields — the same form adds a case and corrects one, so the two can
 * never ask for different things. A new case clears itself once saved; an edit closes.
 * What was typed is kept when a save is refused (a wrong tooth number), so it can be fixed.
 */
function LabCaseForm({
  itemTypes,
  initial,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  itemTypes: string[];
  initial?: LabCaseRow;
  pending: boolean;
  submitLabel: string;
  onSubmit: (input: LabCaseInput) => Promise<Result>;
  onCancel?: () => void;
}) {
  const [item, setItem] = useState(initial?.item ?? itemTypes[0] ?? "crown");
  const [labName, setLabName] = useState(initial?.labName ?? "");
  const [contactName, setContactName] = useState(initial?.labContactName ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.labContactPhone ?? "");
  const [tooth, setTooth] = useState(initial?.tooth ?? "");
  const [shade, setShade] = useState(initial?.shade ?? "");
  const [due, setDue] = useState(initial?.dueYmd ?? "");
  const [cost, setCost] = useState(initial?.cost != null ? String(initial.cost) : "");
  const [note, setNote] = useState(initial?.note ?? "");

  const submit = async () => {
    // Checked here too so a mistyped number is caught before anything is sent;
    // the server applies the same rule.
    if (!toE164(contactPhone).valid) return;
    const r = await onSubmit({
      item,
      labName: labName || null,
      labContactName: contactName || null,
      labContactPhone: contactPhone || null,
      tooth: tooth || null,
      shade: shade || null,
      dueAt: due || null,
      cost: cost ? Number(cost) : null,
      note: note || null,
    });
    if ("ok" in r && !initial) {
      setLabName(""); setContactName(""); setContactPhone(""); setTooth(""); setShade(""); setDue(""); setCost(""); setNote("");
    }
  };
  const phoneInvalid = contactPhone !== "" && !toE164(contactPhone).valid;

  return (
    <div className={initial ? "space-y-2 rounded-md border well p-2.5" : "space-y-2 rounded-xl border border-border/70 bg-surface-sunken p-3.5"}>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Item">
          <SelectField
            value={item}
            onValueChange={(next) => setItem(next)}
            options={[...itemTypes.map((t) => ({ value: t, label: t }))]}
            ariaLabel="Item"
            className="h-8 w-full capitalize"
          />
        </Field>
        <Field label="Lab"><Input value={labName} onChange={(e) => setLabName(e.target.value)} className="h-8 w-36" placeholder="Lab name" /></Field>
        <Field label="Lab contact person"><Input value={contactName} onChange={(e) => setContactName(e.target.value)} className="h-8 w-40" placeholder="Who to call at the lab" maxLength={120} /></Field>
        <Field label="Lab contact number">
          <Input
            type="tel"
            inputMode="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(sanitisePhoneInput(e.target.value))}
            pattern={PHONE_PATTERN}
            title={PHONE_ERROR}
            maxLength={16}
            placeholder={PHONE_PLACEHOLDER}
            aria-invalid={phoneInvalid || undefined}
            className="h-8 w-36"
          />
        </Field>
        <Field label="Tooth / teeth">
          <Input value={tooth} onChange={(e) => setTooth(e.target.value)} className="h-8 w-32" placeholder="47, 48, 53" maxLength={150} />
        </Field>
        <Field label="Shade"><Input value={shade} onChange={(e) => setShade(e.target.value)} className="h-8 w-16" placeholder="A2" /></Field>
        <Field label="Due"><div className={DATE_FIELD_W}><DatePicker ariaLabel="Due date" value={due} onChange={setDue} /></div></Field>
        <Field label="Cost (Rs)"><Input value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} className="h-8 w-24" /></Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-48" placeholder="e.g. rush, metal-free" maxLength={500} /></Field>
      </div>
      {phoneInvalid ? <p className="text-xs text-destructive-text">Lab contact number: {PHONE_ERROR}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || phoneInvalid} onClick={submit}>
          {initial ? null : <Plus className="size-4" />} {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
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
