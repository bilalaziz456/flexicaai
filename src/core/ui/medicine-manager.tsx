"use client";

import { useActionState, useState } from "react";
import { Pencil, Pill, Plus, RotateCcw } from "lucide-react";
import { ActionForm } from "@/core/ui/action-form";
import { Button } from "@/core/ui/button";
import { Checkbox } from "@/core/ui/checkbox";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { DataTable, type Column } from "@/core/ui/data-table";
import { Dialog } from "@/core/ui/dialog";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { SuggestInput } from "@/core/ui/suggest-input";
import { Label } from "@/core/ui/label";
import { Badge } from "@/core/ui/badge";
import { useActionToast } from "@/core/ui/toast";

export type MedicineRowView = {
  id: string;
  name: string;
  brands: string[];
  form: string | null;
  strength: string | null;
  specialties?: string[];
  createdByName?: string | null;
};

export type MedicineFormState = { error?: string; saved?: boolean };

/** Forms the desk meets most, offered as suggestions; any other word is accepted. */
const COMMON_FORMS = [
  "tablet", "capsule", "syrup", "suspension", "drops", "injection", "cream", "ointment",
  "gel", "lotion", "mouthwash", "spray", "sachet", "inhaler", "shampoo", "solution",
];

/**
 * A medicine list with add / edit / remove — the super admin's master list and a
 * clinic's own list share this one component (owner's call, 2026-10-19). It knows
 * nothing about either panel: what may be done, and the server actions that do it,
 * are handed in (ADR-019). `removeLabel` is "Retire" for the master list (kept for old
 * prescriptions) and "Delete" for a clinic's own (soft delete).
 */
export function MedicineManager({
  rows,
  can,
  saveAction,
  removeAction,
  restoreAction,
  removeLabel,
  specialtyOptions,
  retiredView = false,
  showAddedBy = true,
  empty,
}: {
  rows: MedicineRowView[];
  can: { create: boolean; edit: boolean; remove: boolean };
  saveAction: (id: string | null, prev: MedicineFormState, fd: FormData) => Promise<MedicineFormState>;
  removeAction: (id: string) => Promise<MedicineFormState>;
  /** Shown instead of remove on a list of retired medicines. */
  restoreAction?: (id: string) => Promise<MedicineFormState>;
  removeLabel: string;
  /** The specialties a master medicine can be tagged with (admin only). */
  specialtyOptions?: { value: string; label: string }[];
  retiredView?: boolean;
  /** Off where "Added by" would name company staff to a clinic. */
  showAddedBy?: boolean;
  empty: { title: string; description: string };
}) {
  const [editing, setEditing] = useState<MedicineRowView | "new" | null>(null);
  const specialtyLabel = new Map((specialtyOptions ?? []).map((o) => [o.value, o.label]));

  const columns: Column<MedicineRowView>[] = [
    {
      id: "name",
      header: "Medicine",
      cardTitle: true,
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-medium">{r.name}</span>
          {r.brands.length ? (
            <span className="block text-xs text-muted-foreground">{r.brands.join(", ")}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "form",
      header: "Form & strength",
      sortValue: (r) => `${r.form ?? ""} ${r.strength ?? ""}`,
      cell: (r) => {
        const text = [r.form, r.strength].filter(Boolean).join(" · ");
        return text ? <span className="text-sm">{text}</span> : <span className="text-muted-foreground">—</span>;
      },
    },
    ...(specialtyOptions
      ? [
          {
            id: "specialties",
            header: "Shown first for",
            cell: (r: MedicineRowView) =>
              r.specialties?.length ? (
                <span className="flex flex-wrap gap-1">
                  {r.specialties.map((s) => (
                    <Badge key={s} variant="secondary">{specialtyLabel.get(s) ?? s}</Badge>
                  ))}
                </span>
              ) : (
                <span className="text-muted-foreground">Everyone</span>
              ),
          } satisfies Column<MedicineRowView>,
        ]
      : []),
    ...(showAddedBy
      ? [
          {
            id: "by",
            header: "Added by",
            sortValue: (r: MedicineRowView) => r.createdByName ?? "",
            cell: (r: MedicineRowView) => <span className="text-sm text-muted-foreground">{r.createdByName ?? "—"}</span>,
          } satisfies Column<MedicineRowView>,
        ]
      : []),
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          {retiredView ? (
            can.remove && restoreAction ? (
              <Button size="sm" variant="outline" onClick={() => void restoreAction(r.id)}>
                <RotateCcw className="size-3.5" aria-hidden="true" /> Bring back
              </Button>
            ) : null
          ) : (
            <>
              {can.edit ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Edit ${r.name}`}
                  title="Edit"
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
              {can.remove ? (
                <ConfirmDialog
                  triggerLabel={removeLabel}
                  triggerVariant="ghost"
                  triggerClassName="h-8 text-destructive-text"
                  title={`${removeLabel} ${r.name}?`}
                  description={
                    removeLabel === "Retire"
                      ? "It stops being suggested to every clinic. Prescriptions that name it are unchanged, and you can bring it back."
                      : "It stops being suggested on your prescriptions. Prescriptions that name it are unchanged."
                  }
                  confirmLabel={removeLabel}
                  confirmVariant="destructive"
                  onConfirm={() => removeAction(r.id)}
                />
              ) : null}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {can.create && !retiredView ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing("new")} data-shortcut="create">
            <Plus className="size-4" aria-hidden="true" /> Add medicine
          </Button>
        </div>
      ) : null}
      {rows.length ? (
        <DataTable rows={rows} columns={columns} getRowKey={(r) => r.id} empty={empty.title} />
      ) : (
        <EmptyState icon={Pill} title={empty.title} description={empty.description} />
      )}
      {editing ? (
        <MedicineDialog
          // A fresh form per medicine, so a second edit never shows the first one's values.
          key={editing === "new" ? "new" : editing.id}
          medicine={editing === "new" ? null : editing}
          saveAction={saveAction}
          specialtyOptions={specialtyOptions}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function MedicineDialog({
  medicine,
  saveAction,
  specialtyOptions,
  onClose,
}: {
  medicine: MedicineRowView | null;
  saveAction: (id: string | null, prev: MedicineFormState, fd: FormData) => Promise<MedicineFormState>;
  specialtyOptions?: { value: string; label: string }[];
  onClose: () => void;
}) {
  const [specialties, setSpecialties] = useState<Set<string>>(() => new Set(medicine?.specialties ?? []));
  const [state, formAction, pending] = useActionState<MedicineFormState, FormData>(async (prev, fd) => {
    const res = await saveAction(medicine?.id ?? null, prev, fd);
    if (res.saved) onClose();
    return res;
  }, {});
  useActionToast(state, { saved: medicine ? "Medicine updated." : "Medicine added." });

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())} title={medicine ? `Edit ${medicine.name}` : "Add medicine"}>
      <ActionForm action={formAction} state={state} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="med-name">Generic name</Label>
          <Input id="med-name" name="name" required maxLength={120} defaultValue={medicine?.name ?? ""} placeholder="e.g. Amoxicillin + Clavulanic acid" autoFocus />
        </div>
        <div className="space-y-1">
          <Label htmlFor="med-brands">Brands</Label>
          <Input id="med-brands" name="brands" maxLength={600} defaultValue={medicine?.brands.join(", ") ?? ""} placeholder="e.g. Augmentin, Calamox (comma between them)" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="med-form">Form</Label>
            <SuggestInput
              id="med-form"
              name="form"
              maxLength={40}
              defaultValue={medicine?.form ?? ""}
              placeholder="e.g. tablet"
              suggestions={COMMON_FORMS.map((f) => ({ value: f }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="med-strength">Strength</Label>
            <Input id="med-strength" name="strength" maxLength={40} defaultValue={medicine?.strength ?? ""} placeholder="e.g. 625 mg" />
          </div>
        </div>
        {specialtyOptions?.length ? (
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Show first for</legend>
            <p className="text-xs text-muted-foreground">
              Every clinic can find it; clinics of these specialties see it at the top. Leave all unticked for a general medicine.
            </p>
            <div className="flex flex-wrap gap-4">
              {specialtyOptions.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={specialties.has(o.value)}
                    onCheckedChange={(on) => {
                      const next = new Set(specialties);
                      if (on) next.add(o.value);
                      else next.delete(o.value);
                      setSpecialties(next);
                    }}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            {[...specialties].map((s) => (
              <input key={s} type="hidden" name="specialty" value={s} />
            ))}
          </fieldset>
        ) : null}
        {state.error ? <p className="text-sm text-destructive-text">{state.error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : medicine ? "Save" : "Add medicine"}</Button>
        </div>
      </ActionForm>
    </Dialog>
  );
}
