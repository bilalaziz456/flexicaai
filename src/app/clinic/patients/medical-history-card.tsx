"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Badge } from "@/core/ui/badge";
import { Toast } from "@/core/ui/toast";
import {
  MEDICAL_CONDITIONS,
  asMedicalHistory,
  type Allergy,
  type Medication,
  type MedicalHistoryData,
} from "@/core/lib/medical-history";
import { saveMedicalHistoryAction } from "./patient-clinical-actions";

const SEVERITIES = ["", "mild", "moderate", "severe"];

/** The medical & dental history card — read-only summary + an edit form. */
export function MedicalHistoryCard({
  history,
  patientId,
  canEdit,
}: {
  history: MedicalHistoryData;
  patientId: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState<MedicalHistoryData>(asMedicalHistory(history));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);

  const set = <K extends keyof MedicalHistoryData>(k: K, v: MedicalHistoryData[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const save = () =>
    start(async () => {
      const r = await saveMedicalHistoryAction(patientId, data);
      if ("error" in r) setMsg({ text: r.error, error: true });
      else {
        setMsg({ text: "Medical history saved.", error: false });
        setEditing(false);
      }
      setNonce((n) => n + 1);
    });

  if (!editing) {
    const empty =
      data.allergies.length === 0 &&
      data.conditions.length === 0 &&
      data.medications.length === 0 &&
      !data.smoking &&
      !data.alcohol &&
      !data.notes;
    return (
      <div className="space-y-3 text-sm">
        {empty ? (
          <p className="text-muted-foreground">No medical history recorded.</p>
        ) : (
          <>
            {data.allergies.length > 0 ? (
              <Row label="Allergies">
                <div className="flex flex-wrap gap-1.5">
                  {data.allergies.map((a, i) => (
                    <Badge key={i} variant="destructive">
                      {a.substance}
                      {a.severity ? ` · ${a.severity}` : ""}
                    </Badge>
                  ))}
                </div>
              </Row>
            ) : null}
            {data.conditions.length > 0 ? (
              <Row label="Conditions">
                <div className="flex flex-wrap gap-1.5">
                  {data.conditions.map((c) => (
                    <Badge key={c} variant="secondary">{c}</Badge>
                  ))}
                </div>
              </Row>
            ) : null}
            {data.medications.length > 0 ? (
              <Row label="Medications">
                {data.medications.map((m, i) => (
                  <span key={i}>{m.name}{m.dose ? ` (${m.dose})` : ""}{i < data.medications.length - 1 ? ", " : ""}</span>
                ))}
              </Row>
            ) : null}
            {data.smoking ? <Row label="Smoking">{data.smoking}</Row> : null}
            {data.alcohol ? <Row label="Alcohol">{data.alcohol}</Row> : null}
            {data.notes ? <Row label="Notes">{data.notes}</Row> : null}
          </>
        )}
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit medical history
          </Button>
        ) : null}
        <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
      </div>
    );
  }

  // ---- Edit form ----
  return (
    <div className="space-y-4 text-sm">
      {/* Allergies */}
      <Field label="Allergies">
        <div className="space-y-2">
          {data.allergies.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-40"
                placeholder="Substance"
                value={a.substance}
                onChange={(e) => set("allergies", replace(data.allergies, i, { ...a, substance: e.target.value }))}
              />
              <Input
                className="h-8 w-40"
                placeholder="Reaction"
                value={a.reaction ?? ""}
                onChange={(e) => set("allergies", replace(data.allergies, i, { ...a, reaction: e.target.value }))}
              />
              <select
                className="h-8 rounded-lg border border-input bg-[var(--input-bg)] pl-2 pr-8 text-sm outline-none select-chevron"
                value={a.severity ?? ""}
                onChange={(e) => set("allergies", replace(data.allergies, i, { ...a, severity: e.target.value }))}
              >
                {SEVERITIES.map((s) => <option key={s} value={s}>{s || "severity"}</option>)}
              </select>
              <button type="button" onClick={() => set("allergies", remove(data.allergies, i))} aria-label="Remove allergy">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set("allergies", [...data.allergies, { substance: "" } as Allergy])}>
            <Plus className="size-4" /> Allergy
          </Button>
        </div>
      </Field>

      {/* Conditions */}
      <Field label="Conditions">
        <div className="flex flex-wrap gap-2">
          {MEDICAL_CONDITIONS.map((c) => {
            const on = data.conditions.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => set("conditions", on ? data.conditions.filter((x) => x !== c) : [...data.conditions, c])}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Medications */}
      <Field label="Medications">
        <div className="space-y-2">
          {data.medications.map((m, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input className="h-8 w-40" placeholder="Name" value={m.name} onChange={(e) => set("medications", replace(data.medications, i, { ...m, name: e.target.value }))} />
              <Input className="h-8 w-32" placeholder="Dose" value={m.dose ?? ""} onChange={(e) => set("medications", replace(data.medications, i, { ...m, dose: e.target.value }))} />
              <button type="button" onClick={() => set("medications", remove(data.medications, i))} aria-label="Remove medication">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => set("medications", [...data.medications, { name: "" } as Medication])}>
            <Plus className="size-4" /> Medication
          </Button>
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Smoking"><Input className="h-8" value={data.smoking ?? ""} onChange={(e) => set("smoking", e.target.value)} placeholder="e.g. 10/day" /></Field>
        <Field label="Alcohol"><Input className="h-8" value={data.alcohol ?? ""} onChange={(e) => set("alcohol", e.target.value)} placeholder="e.g. occasional" /></Field>
      </div>
      <Field label="Notes">
        <textarea
          className="min-h-16 w-full rounded-lg border border-input bg-[var(--input-bg)] p-2 text-sm outline-none focus-visible:border-ring"
          value={data.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save history"}</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => { setData(asMedicalHistory(history)); setEditing(false); }}>Cancel</Button>
      </div>
      <Toast message={msg?.text ?? null} variant={msg?.error ? "error" : "success"} token={nonce} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
function replace<T>(arr: T[], i: number, v: T): T[] {
  const next = [...arr];
  next[i] = v;
  return next;
}
function remove<T>(arr: T[], i: number): T[] {
  return arr.filter((_, j) => j !== i);
}
