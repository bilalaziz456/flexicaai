"use client";

import { X } from "lucide-react";
import { Checkbox } from "@/core/ui/checkbox";
import { Input } from "@/core/ui/input";
import { SelectField } from "@/core/ui/select-field";
import {
  DURATION_UNITS,
  MEDICATION_FORMS,
  MEDICATION_FREQUENCIES,
  MEDICATION_INSTRUCTIONS,
  type Medication,
} from "@/core/lib/medical-history";

/**
 * One medicine: name, dose, type, frequency (or a typed "2-2-2"), duration — and, in
 * the medical history only, Ongoing. Shared by the medical history and typed
 * prescriptions so a medicine is entered the same way in both places. `warning` shows
 * under the row (an allergy clash); `suggestionsId` points the name at a <datalist>.
 */
export function MedicineRow({
  value: m,
  onChange,
  onRemove,
  showOngoing = false,
  warning,
  suggestionsId,
  namePlaceholder = "Name, e.g. Warfarin",
  showNote = false,
  showInstruction = false,
  invalid = false,
}: {
  value: Medication;
  onChange: (next: Medication) => void;
  onRemove: () => void;
  showOngoing?: boolean;
  warning?: string | null;
  suggestionsId?: string;
  namePlaceholder?: string;
  /** A short note for this medicine ("with plenty of water") — on prescriptions. */
  showNote?: boolean;
  /** Before / after which meal ("After meal", or None) — on prescriptions. */
  showInstruction?: boolean;
  /** Mark the row as failing a check (red border; the message comes as `warning`). */
  invalid?: boolean;
}) {
  const patch = (p: Partial<Medication>) => onChange({ ...m, ...p });
  return (
    // One box per medicine; the fields wrap onto a second line on a tablet.
    <div className={`space-y-1.5 rounded-lg border well p-2 ${invalid ? "border-destructive/60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-44"
          aria-label="Medication name"
          placeholder={namePlaceholder}
          value={m.name}
          list={suggestionsId}
          aria-invalid={invalid && !m.name.trim() ? true : undefined}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <Input
          className="h-8 w-36"
          aria-label="Medication dose"
          placeholder="Dose, e.g. 5 mg"
          value={m.dose ?? ""}
          onChange={(e) => patch({ dose: e.target.value })}
        />
        <SelectField
          value={m.form ?? ""}
          onValueChange={(v) => patch({ form: (v || undefined) as Medication["form"] })}
          options={[{ value: "", label: "Type" }, ...MEDICATION_FORMS.map((o) => ({ value: o.value, label: o.label }))]}
          ariaLabel="Medication type"
          className="h-8 w-auto"
        />
        <SelectField
          value={m.frequency ?? ""}
          onValueChange={(v) => patch({ frequency: (v || undefined) as Medication["frequency"] })}
          options={[{ value: "", label: "Frequency" }, ...MEDICATION_FREQUENCIES.map((o) => ({ value: o.value, label: o.label }))]}
          ariaLabel="Medication frequency"
          className="h-8 w-auto"
        />
        {showInstruction ? (
          <SelectField
            value={m.instruction ?? ""}
            onValueChange={(v) => patch({ instruction: (v || undefined) as Medication["instruction"] })}
            options={[
              ...MEDICATION_INSTRUCTIONS.map((o) => ({ value: o.value, label: o.label })),
              { value: "", label: "None" },
            ]}
            ariaLabel="When to take it"
            className="h-8 w-auto"
          />
        ) : null}
        {m.frequency === "other" ? (
          <Input
            className="h-8 w-32"
            aria-label="Frequency as written"
            placeholder="e.g. 2-2-2"
            maxLength={30}
            value={m.frequencyOther ?? ""}
            onChange={(e) => patch({ frequencyOther: e.target.value })}
          />
        ) : null}
        <div className="flex items-center gap-1" role="group" aria-label="Duration">
          <Input
            className="h-8 w-16"
            inputMode="numeric"
            aria-label="Duration"
            placeholder="For"
            value={m.durationValue ? String(m.durationValue) : ""}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^\d]/g, "").slice(0, 3));
              patch({ durationValue: n > 0 ? n : undefined, durationUnit: m.durationUnit ?? "days" });
            }}
          />
          <SelectField
            value={m.durationUnit ?? "days"}
            onValueChange={(v) => patch({ durationUnit: v as Medication["durationUnit"] })}
            options={DURATION_UNITS.map((o) => ({ value: o.value, label: o.label }))}
            ariaLabel="Duration unit"
            className="h-8 w-auto"
          />
        </div>
        {showOngoing ? (
          <label className="flex min-h-6 items-center gap-1.5 text-sm">
            <Checkbox checked={Boolean(m.ongoing)} onCheckedChange={(on) => patch({ ongoing: on === true ? true : undefined })} />
            Ongoing
          </label>
        ) : null}
        <button type="button" onClick={onRemove} aria-label="Remove medication" className="ml-auto">
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>
      {showNote ? (
        <Input
          className="h-8 w-full"
          aria-label="Note for this medicine"
          placeholder="Note, e.g. with plenty of water"
          maxLength={300}
          value={m.note ?? ""}
          onChange={(e) => patch({ note: e.target.value })}
        />
      ) : null}
      {warning ? (
        <p role="alert" className="text-xs font-medium text-destructive-text">
          {warning}
        </p>
      ) : null}
    </div>
  );
}
