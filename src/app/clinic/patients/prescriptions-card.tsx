"use client";

import { useId, useState, useTransition } from "react";
import { Download, FileText, Pencil, Pill, Plus, Printer, Trash2 } from "lucide-react";
import { Badge } from "@/core/ui/badge";
import { Button, buttonVariants } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { DatePicker } from "@/core/ui/date-picker";
import { Dialog } from "@/core/ui/dialog";
import { EmptyState } from "@/core/ui/empty-state";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
import { toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import {
  allergyConflicts,
  DEFAULT_MEDICATION_INSTRUCTION,
  type Allergy,
  type Medication,
} from "@/core/lib/medical-history";
import { checkPrescription, describePrescriptionItem, type PrescriptionItem, type RxProblem } from "@/core/lib/prescription-items";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { MedicineRow } from "./medicine-row";
import { deletePrescriptionAction, savePrescriptionAction } from "./prescription-actions";

export type TypedPrescription = {
  id: string;
  prescribedOn: string; // YYYY-MM-DD
  dateLabel: string;
  doctorId: string | null;
  doctorName: string | null;
  appointmentId: string | null;
  items: PrescriptionItem[];
  notes: string | null;
  createdByName: string | null;
};
export type GeneratedPrescription = {
  visitId: string;
  dateLabel: string;
  sortKey: string; // YYYY-MM-DD
  doctor: string;
  drugs: { drug: string; dosage: string | null; duration: string | null }[];
};

type Option = { value: string; label: string };

// A new line starts at "After meal" (owner's call); the desk picks None to drop it.
const emptyItem = (): Medication => ({ name: "", instruction: DEFAULT_MEDICATION_INSTRUCTION });

/**
 * The patient's prescriptions: ones TYPED at the desk from what the doctor wrote
 * (printed on the clinic's letterhead — owner's call, 2026-10-14) and ones from approved
 * scribe notes, newest first. Typed ones can be edited, deleted (to Trash), viewed,
 * downloaded, or printed on the clinic's own pre-printed pad.
 */
export function PrescriptionsCard({
  patientId,
  typed,
  generated,
  doctors,
  appointments,
  defaults,
  allergies,
  formularyNames,
  can,
}: {
  patientId: string;
  typed: TypedPrescription[];
  generated: GeneratedPrescription[];
  doctors: Option[];
  appointments: (Option & { doctorId: string | null })[];
  /** Today's date, and today's appointment and its doctor. */
  defaults: { date: string; appointmentId: string | null; doctorId: string | null };
  allergies: Allergy[];
  formularyNames: string[];
  can: { create: boolean; edit: boolean; delete: boolean };
}) {
  const [editing, setEditing] = useState<TypedPrescription | "new" | null>(null);

  const rows = [
    ...typed.map((t) => ({ kind: "typed" as const, key: `t-${t.id}`, sort: t.prescribedOn, t })),
    ...generated.map((g) => ({ kind: "generated" as const, key: `g-${g.visitId}`, sort: g.sortKey, g })),
  ].sort((a, b) => b.sort.localeCompare(a.sort));

  const del = async (t: TypedPrescription) => {
    const r = await deletePrescriptionAction(t.id, patientId);
    if ("error" in r) return { error: r.error };
    toast.success("Prescription moved to Trash.");
  };

  return (
    <div className="space-y-3">
      {can.create ? (
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden="true" /> New prescription
        </Button>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Pill}
          title="No prescriptions yet"
          description={
            can.create
              ? "Add the doctor's prescription to print it on the clinic's letterhead."
              : "Prescriptions for this patient appear here."
          }
        />
      ) : (
        <ol className="divide-y divide-border/60 rounded-lg border border-border/60">
          {rows.map((r) =>
            r.kind === "typed" ? (
              <li key={r.key} className="space-y-1.5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {r.t.dateLabel}
                    {r.t.doctorName ? <span className="text-muted-foreground"> · {r.t.doctorName}</span> : null}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Named by WHAT COMES OUT (owner's call, 2026-10-15). "Print on pad",
                        then "Print on letterhead paper", both read as if they printed
                        the letterhead — the opposite of what they do. */}
                    <a
                      href={`/api/rx/${r.t.id}`}
                      target="_blank"
                      rel="noreferrer"
                      title="For plain white paper: the clinic letterhead is printed with the prescription"
                      // The one used most, so it is the green main action (owner's call).
                      className={cn(buttonVariants({ size: "sm" }))}
                    >
                      <FileText className="size-3.5" aria-hidden="true" /> Print with letterhead
                    </a>
                    <a
                      href={`/api/rx/${r.t.id}?pad=1`}
                      target="_blank"
                      rel="noreferrer"
                      title="For paper that already has your letterhead printed on it: only the prescription is printed, in the right place"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <Printer className="size-3.5" aria-hidden="true" /> Print without letterhead
                    </a>
                    <a
                      href={`/api/rx/${r.t.id}?download=1`}
                      title="Save the PDF with the letterhead, e.g. to send on WhatsApp"
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      <Download className="size-3.5" aria-hidden="true" /> Download
                    </a>
                    {can.edit ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(r.t)} aria-label="Edit prescription">
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                    {can.delete ? (
                      <ConfirmDialog
                        triggerLabel="Delete"
                        triggerIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                        triggerVariant="ghost"
                        triggerClassName="[&>span]:hidden"
                        title="Delete this prescription?"
                        description={`The prescription of ${r.t.dateLabel} moves to Trash, where it can be restored.`}
                        confirmLabel="Delete"
                        confirmVariant="destructive"
                        cancelLabel="Keep"
                        onConfirm={() => del(r.t)}
                      />
                    ) : null}
                  </div>
                </div>
                <ul className="space-y-0.5">
                  {r.t.items.map((it, i) => {
                    const d = describePrescriptionItem(it);
                    return (
                      <li key={i}>
                        <span className="font-medium">{it.name}</span>
                        {it.dose ? ` ${it.dose}` : ""}
                        {d ? <span className="text-muted-foreground"> · {d}</span> : null}
                        {it.note ? <span className="text-muted-foreground"> · {it.note}</span> : null}
                      </li>
                    );
                  })}
                </ul>
                {r.t.notes ? <p className="whitespace-pre-line text-muted-foreground">Notes: {r.t.notes}</p> : null}
              </li>
            ) : (
              <li key={r.key} className="space-y-1 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {r.g.dateLabel}
                    <span className="text-muted-foreground"> · {r.g.doctor}</span>{" "}
                    <Badge variant="secondary">From visit note</Badge>
                  </span>
                  <a href={`/api/prescriptions/${r.g.visitId}`} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    <Printer className="size-3.5" aria-hidden="true" /> Print
                  </a>
                </div>
                <p className="text-muted-foreground">
                  {r.g.drugs
                    .map((d) => d.drug + (d.dosage ? ` (${d.dosage}${d.duration ? `, ${d.duration}` : ""})` : d.duration ? ` (${d.duration})` : ""))
                    .join(" · ")}
                </p>
              </li>
            ),
          )}
        </ol>
      )}

      {editing ? (
        <PrescriptionDialog
          key={editing === "new" ? "new" : editing.id}
          patientId={patientId}
          existing={editing === "new" ? null : editing}
          doctors={doctors}
          appointments={appointments}
          defaults={defaults}
          allergies={allergies}
          formularyNames={formularyNames}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function PrescriptionDialog({
  patientId,
  existing,
  doctors,
  appointments,
  defaults,
  allergies,
  formularyNames,
  onClose,
}: {
  patientId: string;
  existing: TypedPrescription | null;
  doctors: Option[];
  appointments: (Option & { doctorId: string | null })[];
  defaults: { date: string; appointmentId: string | null; doctorId: string | null };
  allergies: Allergy[];
  formularyNames: string[];
  onClose: () => void;
}) {
  const listId = useId();
  const [doctorId, setDoctorId] = useState(existing?.doctorId ?? defaults.doctorId ?? "");
  const [date, setDate] = useState(existing?.prescribedOn ?? defaults.date);
  const [appointmentId, setAppointmentId] = useState(existing ? (existing.appointmentId ?? "") : (defaults.appointmentId ?? ""));
  const [items, setItems] = useState<Medication[]>(existing?.items.length ? existing.items : [emptyItem()]);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<RxProblem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The appointment list follows the doctor: only THEIR visits for this patient.
  const doctorAppointments = appointments.filter((a) => a.doctorId === doctorId);
  const chooseDoctor = (id: string) => {
    setDoctorId(id);
    // A visit with another doctor no longer fits; drop it rather than keep a mismatch.
    if (appointmentId && !appointments.some((a) => a.value === appointmentId && a.doctorId === id)) setAppointmentId("");
    setProblems((p) => p.filter((x) => x.field !== "doctor"));
  };

  const fieldProblem = (f: RxProblem["field"]) => problems.find((p) => p.field === f)?.message ?? null;
  const lineProblem = (i: number) => problems.find((p) => p.field === "line" && p.line === i)?.message ?? null;

  const save = (then: "close" | "view" | "download") => {
    const found = checkPrescription({ doctorId, prescribedOn: date, items, notes }, defaults.date);
    setProblems(found);
    setError(null);
    if (found.length > 0) return;
    // Opened NOW, inside the click, so the browser does not block it as a pop-up.
    const win = then === "view" ? window.open("", "_blank") : null;
    start(async () => {
      const r = await savePrescriptionAction(existing?.id ?? null, {
        patientId,
        appointmentId: appointmentId || null,
        doctorId,
        prescribedOn: date,
        items,
        notes,
      });
      if ("error" in r) {
        win?.close();
        setError(r.error);
        return;
      }
      toast.success(existing ? "Prescription updated." : "Prescription saved.");
      if (r.id && then === "view" && win) win.location.href = `/api/rx/${r.id}`;
      if (r.id && then === "download") {
        const a = document.createElement("a");
        a.href = `/api/rx/${r.id}?download=1`;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      onClose();
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      size="xl"
      title={existing ? "Edit prescription" : "New prescription"}
      description="What the doctor prescribed. It prints on the clinic's letterhead."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => save("close")} disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="outline" onClick={() => save("view")} disabled={pending}>
            <FileText className="size-4" aria-hidden="true" /> Save &amp; view
          </Button>
          {/* The one used most: the desk saves and hands over or sends the PDF. */}
          <Button type="button" onClick={() => save("download")} disabled={pending}>
            <Download className="size-4" aria-hidden="true" /> {pending ? "Saving…" : "Save & download"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Doctor</Label>
            <SearchableSelect
              ariaLabel="Prescribing doctor"
              value={doctorId}
              onChange={chooseDoctor}
              options={doctors}
              placeholder="Choose the doctor…"
              searchPlaceholder="Search doctors…"
              className="h-9 w-full"
            />
            {fieldProblem("doctor") ? <p className="text-xs text-destructive-text">{fieldProblem("doctor")}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <DatePicker
              value={date}
              onChange={(v) => {
                setDate(v);
                setProblems((p) => p.filter((x) => x.field !== "date"));
              }}
              ariaLabel="Prescription date"
            />
            {fieldProblem("date") ? <p className="text-xs text-destructive-text">{fieldProblem("date")}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label>Appointment (optional)</Label>
            <SelectField
              value={appointmentId}
              onValueChange={setAppointmentId}
              disabled={!doctorId}
              options={[
                {
                  value: "",
                  label: !doctorId ? "Choose the doctor first" : doctorAppointments.length ? "None" : "No visits with this doctor",
                },
                ...doctorAppointments.map(({ value, label }) => ({ value, label })),
              ]}
              ariaLabel="Appointment"
              className="h-9 w-full"
            />
          </div>
        </div>

        <div className="space-y-2" role="group" aria-label="Medicines">
          <p className="text-sm font-medium">Medicines</p>
          {items.map((m, i) => {
            const clash = m.name.trim() ? allergyConflicts(allergies, m.name) : [];
            const problem = lineProblem(i);
            return (
              <MedicineRow
                key={i}
                value={m}
                showNote
                showInstruction
                invalid={Boolean(problem)}
                suggestionsId={listId}
                namePlaceholder="Medicine, e.g. Augmentin"
                warning={problem ?? (clash.length ? `Allergy: the patient is recorded as allergic to ${clash.join(", ")}.` : null)}
                onChange={(next) => {
                  setItems((prev) => prev.map((x, j) => (j === i ? next : x)));
                  if (problem) setProblems((p) => p.filter((x) => !(x.field === "line" && x.line === i)));
                }}
                onRemove={() => setItems((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [emptyItem()]))}
              />
            );
          })}
          <datalist id={listId}>
            {formularyNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {fieldProblem("items") ? <p className="text-xs text-destructive-text">{fieldProblem("items")}</p> : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
            <Plus className="size-4" aria-hidden="true" /> Medicine
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${listId}-notes`}>Notes</Label>
          <textarea
            id={`${listId}-notes`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            placeholder="Advice for the whole prescription, e.g. review in 1 week"
            className="min-h-20 w-full rounded-lg border border-input bg-[var(--input-bg)] p-2 text-sm outline-none focus-visible:border-ring"
          />
          {fieldProblem("notes") ? <p className="text-xs text-destructive-text">{fieldProblem("notes")}</p> : null}
        </div>

        <p className="text-xs text-muted-foreground">The doctor&apos;s name prints at the foot of the prescription: &ldquo;By Dr. …&rdquo;.</p>

        {problems.length > 0 ? (
          <p role="alert" className="text-sm font-medium text-destructive-text">
            Please fix the {problems.length === 1 ? "item" : `${problems.length} items`} marked in red.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive-text">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
