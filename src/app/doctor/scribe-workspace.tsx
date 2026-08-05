"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { NoteEditor } from "@/core/ui/note-editor";
import { clinicalUiFor } from "@/config/clinical-record-ui";
import { approveVisit, discardDraft, loadPatientChart, searchPatients } from "./actions";

type Patient = { id: string; fullName: string; phone: string | null };
type Draft = {
  visitId: string;
  transcript: string;
  note: Record<string, unknown>;
  drugWarnings: string[];
  allergyWarnings?: string[];
};

/**
 * The voice scribe (CLAUDE.md §8). Client component (browser MediaRecorder):
 * pick a patient → record → the /api/ai/scribe route transcribes + drafts a
 * note → the doctor reviews/edits → Approve saves it. Every note is a DRAFT
 * until the doctor approves; nothing is auto-finalized.
 */
export function ScribeWorkspace({
  initialPatients,
  modulesEnabled = [],
}: {
  initialPatients: Patient[];
  /** The clinic's enabled modules — drives the specialty chart editor (if any). */
  modulesEnabled?: string[];
}) {
  const clinicalUi = clinicalUiFor(modulesEnabled);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [results, setResults] = useState<Patient[]>(initialPatients);
  const [query, setQuery] = useState("");

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState<Record<string, unknown>>({});
  // The specialty chart the doctor confirms (e.g. odontogram). Seeded once from the
  // current chart + the note's suggested edits when the draft arrives.
  const [chart, setChart] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function reset() {
    setDraft(null);
    setNote({});
    setChart(null);
    setError(null);
  }

  async function runSearch(q: string) {
    setQuery(q);
    const found = await searchPatients(q);
    setResults(found);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: mime || "audio/webm",
        });
        void submitAudio(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access was denied or is unavailable.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function submitAudio(blob: Blob) {
    if (!patient) return;
    setProcessing(true);
    setError(null);
    try {
      const ext = blob.type.includes("webm") ? "webm" : "wav";
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);
      form.append("patientId", patient.id);
      const res = await fetch("/api/ai/scribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Scribe failed.");
        return;
      }
      setDraft(data as Draft);
      setNote((data as Draft).note);
      // Seed the specialty chart: the patient's current chart overlaid with the
      // note's suggested edits — a pre-filled chart the doctor reviews (still a draft).
      if (clinicalUi) {
        const current = (await loadPatientChart(patient.id)) as Record<string, unknown> | null;
        const seeded = clinicalUi.seedFromNote((data as Draft).note) as Record<string, unknown>;
        setChart({ ...(current ?? {}), ...(seeded ?? {}) });
      }
    } catch {
      setError("Could not reach the scribe. Check your connection.");
    } finally {
      setProcessing(false);
    }
  }

  function onApprove() {
    if (!draft) return;
    setError(null);
    startTransition(async () => {
      const r = await approveVisit(draft.visitId, note, clinicalUi ? chart : undefined);
      if ("error" in r) setError(r.error);
      else {
        reset();
        setPatient(null);
      }
    });
  }

  function onDiscard() {
    if (!draft) return;
    startTransition(async () => {
      await discardDraft(draft.visitId);
      reset();
    });
  }

  // ---- Review the AI draft ----
  if (draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Review draft — {patient?.fullName}</CardTitle>
          <CardDescription>
            AI-generated draft. Edit anything, then approve to save. Nothing is
            saved to the record until you approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.allergyWarnings && draft.allergyWarnings.length > 0 && (
            <div className="rounded-md border border-red-500/60 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              <p className="font-semibold">⚠ Allergy conflict — review before prescribing:</p>
              <ul className="mt-1 list-inside list-disc">
                {draft.allergyWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.drugWarnings.length > 0 && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">Check these drugs — not in the formulary:</p>
              <p className="text-muted-foreground">{draft.drugWarnings.join(", ")}</p>
            </div>
          )}

          <details className="rounded-md border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Transcript</summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {draft.transcript}
            </p>
          </details>

          <NoteEditor note={note} onChange={setNote} />

          {clinicalUi ? (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Tooth chart</p>
              <p className="text-xs text-muted-foreground">
                Pre-filled from the note. Adjust any tooth — it saves with the visit and
                updates the patient&apos;s odontogram on approval.
              </p>
              <clinicalUi.VisitEditor value={chart} onChange={setChart} />
            </div>
          ) : null}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={onApprove} disabled={pending}>
              {pending ? "Saving…" : "Approve & save"}
            </Button>
            <Button variant="outline" onClick={onDiscard} disabled={pending}>
              Discard
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Record ----
  return (
    <Card>
      <CardHeader>
        <CardTitle>New note</CardTitle>
        <CardDescription>
          {patient
            ? `Recording for ${patient.fullName}.`
            : "Choose a patient, then record the visit."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!patient ? (
          <div className="space-y-3">
            <Input
              aria-label="Search patients by name or phone"
              placeholder="Search patients by name or phone…"
              value={query}
              onChange={(e) => void runSearch(e.target.value)}
            />
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {results.length === 0 ? (
                <li className="p-3 text-sm text-muted-foreground">
                  No patients found.
                </li>
              ) : (
                results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPatient(p)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="font-medium">{p.fullName}</span>
                      <span className="text-muted-foreground">{p.phone ?? ""}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-accent px-2.5 py-1 text-sm font-medium text-accent-foreground">
                {patient.fullName}
              </span>
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4"
                onClick={() => {
                  setPatient(null);
                  reset();
                }}
              >
                Change
              </button>
            </div>

            {processing ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Transcribing and drafting the note…
              </div>
            ) : recording ? (
              <Button variant="destructive" onClick={stopRecording}>
                <Square className="size-4" aria-hidden="true" />
                Stop & generate
              </Button>
            ) : (
              <Button onClick={startRecording}>
                <Mic className="size-4" aria-hidden="true" />
                Start recording
              </Button>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
