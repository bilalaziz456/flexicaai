"use client";

import { useRef, useState, useTransition } from "react";
import { DictationPlayer } from "@/core/ui/dictation-player";
import { RecordingIndicator } from "@/app/clinic/scribe/recording-indicator";
import { FileClock, Loader2, Mic, PenLine, Square, UserX, X } from "lucide-react";
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
import { SelectField } from "@/core/ui/select-field";
import { clinicalUiFor } from "@/config/clinical-record-ui";
import {
  approveVisit,
  discardDraft,
  loadDraft,
  loadPatientChart,
  saveTypedNote,
  searchPatients,
  getScribeStatus,
} from "@/app/clinic/scribe/actions";

type Patient = { id: string; fullName: string; phone: string | null };
/** The appointment a note is started from (the Clinical notes list, 2026-11-14). */
type ForAppointment = { id: string; label: string; doctorName: string | null };
type PendingDraft = { id: string; visitDate: Date | null; patientName: string };
/** A draft whose author can no longer log in (delta D-18) — see StrandedDrafts. */
type StrandedDraftItem = PendingDraft & { authorName: string | null };
type Draft = {
  visitId: string;
  transcript: string;
  note: Record<string, unknown>;
  drugWarnings: string[];
  allergyWarnings?: string[];
};

/**
 * The voice scribe (CLAUDE.md §8) and the typed note. Client component (browser
 * MediaRecorder): pick a patient → record → the /api/ai/scribe route transcribes +
 * drafts a note → the doctor reviews/edits → Approve saves it. Every AI note is a
 * DRAFT until the doctor approves; nothing is auto-finalized.
 *
 * Or pick a patient → "Type the note" (2026-11-14): the same form, empty, saved
 * straight to the record and signed by its author — nothing machine-written to check.
 * Which of the two a person sees is the clinic admin's call (`scribe` / `clinical`).
 */
export function ScribeWorkspace({
  pendingDrafts = [],
  strandedDrafts = [],
  modulesEnabled = [],
  canRecord = true,
  canType = false,
  writeFor = null,
  writeForChart = null,
  forAppointment = null,
  appointmentPatient = null,
  doctors = [],
}: {
  /** Your own drafts that were never approved — see PendingApproval below. */
  pendingDrafts?: PendingDraft[];
  /** Someone ELSE's drafts, reachable only via `handover` — see StrandedDrafts. */
  strandedDrafts?: StrandedDraftItem[];
  /** The clinic's enabled modules — drives the specialty chart editor (if any). */
  modulesEnabled?: string[];
  /** Voice scribe on for the clinic AND `scribe:create` held. */
  canRecord?: boolean;
  /** `clinical:create`: may write a note by hand. */
  canType?: boolean;
  /** Open straight on a typed note for this patient ("Write note" on their page). */
  writeFor?: Patient | null;
  /** That patient's current chart, loaded by the server so the form opens complete. */
  writeForChart?: unknown;
  /** Started from an appointment: the note is linked to it and belongs to its doctor. */
  forAppointment?: ForAppointment | null;
  /** That appointment's patient, chosen already. */
  appointmentPatient?: Patient | null;
  /** The clinic's doctors other than you, for "Whose patient" on a typed note written
   *  without an appointment. Empty = it is your own patient. */
  doctors?: { id: string; name: string }[];
}) {
  const clinicalUi = clinicalUiFor(modulesEnabled);
  const [patient, setPatient] = useState<Patient | null>(writeFor ?? appointmentPatient);
  // The appointment this note is for; dropped if a different patient is chosen.
  const [appt, setAppt] = useState<ForAppointment | null>(forAppointment);
  // Whose patient a typed note without an appointment is ("" = yours).
  const [forDoctor, setForDoctor] = useState("");
  // "Sent to Dr X for approval" after a save that waits.
  const [notice, setNotice] = useState<string | null>(null);
  // A typed note in progress (no draft behind it).
  const [typing, setTyping] = useState(Boolean(writeFor));
  // The allergy / medicine checks a typed note tripped; saving again confirms them.
  const [typedWarnings, setTypedWarnings] = useState<{ drugWarnings: string[]; allergyWarnings: string[] } | null>(null);
  const [results, setResults] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");

  const [recording, setRecording] = useState(false);
  // The microphone stream while recording, for the live level display.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [processing, setProcessing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState<Record<string, unknown>>({});
  // The specialty chart the doctor confirms (e.g. odontogram). It starts as the
  // patient's CURRENT chart and is saved only if the doctor changes it (owner's call,
  // 2026-10-24) — a misheard dictation must not quietly re-mark a tooth. What the note
  // suggests is offered as one click instead (`chartSuggestion`), never pre-applied.
  const [chart, setChart] = useState<unknown>(writeFor ? (writeForChart ?? {}) : null);
  const [chartBaseline, setChartBaseline] = useState<string>(writeFor ? JSON.stringify(writeForChart ?? {}) : "null");
  const [chartSuggestion, setChartSuggestion] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Cancel (owner's call, 2026-10-24): while recording it drops the audio unsent; once
  // sent, it discards the run. Refs, not state, because the recorder's onstop and the
  // polling loop read them after the render that set them.
  const cancelRecordingRef = useRef(false);
  const cancelledRunRef = useRef(false);
  const runIdRef = useRef<string | null>(null);

  function reset() {
    setTyping(false);
    setTypedWarnings(null);
    setDraft(null);
    setNote({});
    setChart(null);
    setChartBaseline("null");
    setChartSuggestion(null);
    setError(null);
  }

  /**
   * Seed the specialty chart editor: the patient's current chart overlaid with the
   * note's suggested edits — a pre-filled chart the doctor reviews (still a draft).
   * Used by a fresh dictation and by a resumed draft alike.
   */
  async function seedChart(patientId: string, forNote: Record<string, unknown>) {
    if (!clinicalUi) return;
    const current = (await loadPatientChart(patientId)) as Record<string, unknown> | null;
    const seeded = clinicalUi.seedFromNote(forNote) as Record<string, unknown>;
    const start = current ?? {};
    setChart(start);
    setChartBaseline(JSON.stringify(start));
    setChartSuggestion(seeded && Object.keys(seeded).length > 0 ? seeded : null);
  }

  function startTyping() {
    if (!patient) return;
    reset();
    setTyping(true);
    void seedChart(patient.id, {});
  }

  async function runSearch(q: string) {
    setQuery(q);
    const found = await searchPatients(q);
    setResults(found);
  }

  async function startRecording() {
    setError(null);
    try {
      // Dictation, not a call (2026-10-20). With `{ audio: true }` the browser applied
      // its call settings — echo cancellation and noise suppression — which strip the
      // consonants speech-to-text tells words apart by; a test recording reached
      // Whisper with nothing above 3.4 kHz and came back as nonsense. Gain control
      // stays on, so a doctor further from the microphone is still heard; one channel
      // and a higher bitrate keep what the microphone actually caught.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 128_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setLiveStream(null);
        stream.getTracks().forEach((t) => t.stop());
        if (cancelRecordingRef.current) {
          chunksRef.current = [];
          return; // cancelled: nothing is uploaded
        }
        const blob = new Blob(chunksRef.current, {
          type: mime || "audio/webm",
        });
        void submitAudio(blob);
      };
      recorderRef.current = recorder;
      cancelRecordingRef.current = false;
      recorder.start();
      setLiveStream(stream);
      setRecording(true);
    } catch {
      setError("Microphone access was denied or is unavailable.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  /** Stop and throw the recording away — nothing is sent, no note is made. */
  function cancelRecording() {
    cancelRecordingRef.current = true;
    recorderRef.current?.stop();
    setRecording(false);
  }

  /** Stop waiting for the note and discard this run (it goes to Trash). */
  async function cancelRun() {
    cancelledRunRef.current = true;
    setProcessing(false);
    const id = runIdRef.current;
    // Still uploading: submitAudio discards it the moment the server answers.
    if (!id) return;
    runIdRef.current = null;
    const r = await discardDraft(id);
    if ("error" in r) setError(r.error);
  }

  async function submitAudio(blob: Blob) {
    if (!patient) return;
    cancelledRunRef.current = false;
    runIdRef.current = null;
    setProcessing(true);
    setError(null);
    try {
      const ext = blob.type.includes("webm") ? "webm" : "wav";
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);
      form.append("patientId", patient.id);
      if (appt) form.append("appointmentId", appt.id);
      const res = await fetch("/api/ai/scribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Scribe failed.");
        return;
      }
      // The route now ACCEPTS the recording and returns 202 (delta D-08): the audio is
      // stored and the visit exists, but the note is still being written. Wait for it.
      const visitId = data.visitId as string;
      if (cancelledRunRef.current) {
        // Cancel was pressed while this was still uploading.
        await discardDraft(visitId);
        return;
      }
      runIdRef.current = visitId;
      await waitForDraft(visitId);
    } catch {
      setError("Could not reach the scribe. Check your connection.");
    } finally {
      setProcessing(false);
    }
  }

  /**
   * Polls until the run leaves `transcribing`, then opens the draft.
   *
   * Polling rather than a socket: one doctor waiting on one note is not worth a
   * persistent connection on a single-node server, and a poll survives the tab being
   * backgrounded or the network blinking — which a socket does not.
   *
   * The recording is already saved by the time this runs, so giving up here loses
   * nothing: the visit is on the workspace list either way, and the doctor can open it
   * when it lands. That is the whole point of the change — the work no longer belongs
   * to this browser tab.
   */
  async function waitForDraft(visitId: string) {
    const deadline = Date.now() + 6 * 60_000; // beyond the provider budget
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (cancelledRunRef.current) return;
      const s = await getScribeStatus(visitId);
      if (cancelledRunRef.current) return;
      if (!s) break;
      if (s.status === "failed") {
        setError(s.error ?? "The scribe failed. Your recording was kept — try again.");
        return;
      }
      if (s.status === "draft") {
        const d = await loadDraft(visitId);
        if (!d) break;
        setDraft({
          visitId: d.visitId,
          transcript: d.transcript,
          note: d.note,
          drugWarnings: d.drugWarnings,
          allergyWarnings: d.allergyWarnings,
        });
        setNote(d.note);
        await seedChart(d.patient.id, d.note);
        return;
      }
    }
    setError(
      "The note is still being written. Your recording is saved — it will appear in “Pending approval” when it is ready.",
    );
  }

  /**
   * Pick a draft back up. Fetches it into exactly the shape a fresh dictation
   * produces, so the review screen below needs no special case for a resumed note —
   * the doctor edits, approves or discards it the same way either path got them here.
   */
  function onResume(visitId: string) {
    setError(null);
    setResuming(visitId);
    startTransition(async () => {
      try {
        const d = await loadDraft(visitId);
        if (!d) {
          setError("That draft is no longer available. It may have been approved or discarded.");
          return;
        }
        setPatient(d.patient);
        setDraft({
          visitId: d.visitId,
          transcript: d.transcript,
          note: d.note,
          drugWarnings: d.drugWarnings,
          allergyWarnings: d.allergyWarnings,
        });
        setNote(d.note);
        await seedChart(d.patient.id, d.note);
      } finally {
        setResuming(null);
      }
    });
  }

  function onApprove() {
    if (!draft && !(typing && patient)) return;
    setError(null);
    startTransition(async () => {
      // The chart goes with the approval only when the doctor changed it; otherwise
      // the patient's chart is left exactly as it was.
      const chartChanged = clinicalUi && JSON.stringify(chart) !== chartBaseline;
      if (typing && patient) {
        // Second press after the checks showed = the clinician has seen them.
        const r = await saveTypedNote(patient.id, note, chartChanged ? chart : undefined, typedWarnings !== null, {
          appointmentId: appt?.id ?? null,
          doctorId: appt ? null : forDoctor || null,
        });
        if ("warnings" in r) setTypedWarnings(r.warnings);
        else if ("error" in r) setError(r.error);
        else {
          reset();
          setPatient(null);
          setAppt(null);
          setNotice(r.waiting ? "Saved. The patient's doctor has been asked to approve it." : "Note saved.");
        }
        return;
      }
      if (!draft) return;
      const r = await approveVisit(draft.visitId, note, chartChanged ? chart : undefined);
      if ("error" in r) setError(r.error);
      else {
        reset();
        setPatient(null);
        setAppt(null);
        setNotice("waiting" in r && r.waiting ? "Approved. The patient's doctor has been asked to approve it too." : "Note saved.");
      }
    });
  }

  function onDiscard() {
    // A typed note has nothing stored yet: cancelling just closes it.
    if (typing) {
      reset();
      return;
    }
    if (!draft) return;
    startTransition(async () => {
      await discardDraft(draft.visitId);
      reset();
    });
  }

  // ---- Review the AI draft, or write a note by hand ----
  if (draft || (typing && patient)) {
    const warnings = draft ?? typedWarnings;
    const allergyWarnings = warnings?.allergyWarnings ?? [];
    const drugWarnings = warnings?.drugWarnings ?? [];
    return (
      <Card>
        <CardHeader>
          <CardTitle>{draft ? `Review draft: ${patient?.fullName}` : `New note: ${patient?.fullName}`}</CardTitle>
          <CardDescription>
            {draft
              ? "AI-generated draft. Edit anything, then approve to save. Nothing is saved to the record until you approve."
              : "Type the visit note. It is saved to the patient's record, signed by you, when you press Save."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {allergyWarnings.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-text">
              <p className="font-semibold">⚠ Allergy conflict. Review before prescribing:</p>
              <ul className="mt-1 list-inside list-disc">
                {allergyWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {drugWarnings.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">These drugs are not in the formulary:</p>
              <p className="text-muted-foreground">{drugWarnings.join(", ")}</p>
            </div>
          )}

          {draft ? (
            <>
              {/* Listen back when the text looks wrong (2026-10-20). */}
              <DictationPlayer src={`/api/clinical/visit-audio/${draft.visitId}`} />

              <details className="rounded-md border well p-3 text-sm">
                <summary className="cursor-pointer font-medium">Transcript</summary>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {draft.transcript}
                </p>
              </details>
            </>
          ) : null}

          {typing && !draft ? (
            appt ? (
              <p className="text-sm text-muted-foreground">
                For the appointment {appt.label}
                {appt.doctorName ? ` with ${appt.doctorName}` : ""}.
              </p>
            ) : doctors.length > 0 ? (
              <div className="space-y-1">
                <label htmlFor="note-for-doctor" className="text-sm font-medium">
                  Whose patient
                </label>
                <SelectField
                  id="note-for-doctor"
                  ariaLabel="Whose patient"
                  value={forDoctor}
                  onValueChange={setForDoctor}
                  options={[{ value: "", label: "Mine" }, ...doctors.map((d) => ({ value: d.id, label: d.name }))]}
                  className="w-full max-w-xs"
                />
                <p className="text-xs text-muted-foreground">
                  A note for another doctor&apos;s patient may wait for that doctor to approve it.
                </p>
              </div>
            ) : null
          ) : null}

          <NoteEditor
            note={note}
            onChange={(n) => {
              setNote(n);
              // An edited typed note is checked again before it saves.
              if (typing) setTypedWarnings(null);
            }}
          />

          {clinicalUi ? (
            <div className="space-y-2 rounded-lg border well p-3">
              <p className="text-sm font-medium">Tooth chart</p>
              <p className="text-xs text-muted-foreground">
                The patient&apos;s current chart. It is updated on approval only if you
                change it here.
              </p>
              {chartSuggestion ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-xs">
                  <span>The note suggests chart changes for this visit.</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setChart((c: unknown) => ({ ...((c as Record<string, unknown>) ?? {}), ...chartSuggestion }));
                      setChartSuggestion(null);
                    }}
                  >
                    Apply the note&apos;s suggestions
                  </Button>
                </div>
              ) : null}
              <clinicalUi.VisitEditor value={chart} onChange={setChart} />
            </div>
          ) : null}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={onApprove} disabled={pending}>
              {pending ? "Saving…" : draft ? "Approve & save" : typedWarnings ? "Save anyway" : "Save note"}
            </Button>
            <Button variant="outline" onClick={onDiscard} disabled={pending}>
              {draft ? "Discard" : "Cancel"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Record ----
  return (
    <>
      <PendingApproval
        drafts={pendingDrafts}
        onResume={onResume}
        resuming={resuming}
        disabled={pending}
      />

      <StrandedDrafts
        drafts={strandedDrafts}
        onResume={onResume}
        resuming={resuming}
        disabled={pending}
      />

      <Card>
        <CardHeader>
          <CardTitle>New note</CardTitle>
          <CardDescription>
            {patient
              ? canRecord
                ? `For ${patient.fullName}: record the visit${canType ? ", or type the note" : ""}.`
                : `For ${patient.fullName}: type the visit note.`
              : canRecord
                ? `Choose a patient, then record the visit${canType ? " or type the note" : ""}.`
                : "Choose a patient, then type the visit note."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notice ? (
            <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
              {notice}
            </p>
          ) : null}
          {appt && patient ? (
            <p className="text-sm text-muted-foreground">
              Appointment {appt.label}
              {appt.doctorName ? ` with ${appt.doctorName}` : ""}. The note is saved with it.
            </p>
          ) : null}
          {!patient ? (
            <div className="space-y-3">
              <Input
                aria-label="Search patients by name or phone"
                placeholder="Search patients by name or phone…"
                value={query}
                onChange={(e) => void runSearch(e.target.value)}
              />
              {/* No list of patients until something is typed (owner, 2026-11-14): a note
                  mostly starts from the queue or the appointments list, and an unasked-for
                  list of names only pushed the recorder down the page. */}
              {query.trim() ? (
                <ul className="max-h-64 divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60">
                  {results.length === 0 ? (
                    <li className="p-3 text-sm text-muted-foreground">
                      No patients found.
                    </li>
                  ) : (
                    results.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPatient(p);
                            setNotice(null);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          <span className="font-medium">{p.fullName}</span>
                          <span className="text-muted-foreground">{p.phone ?? ""}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-accent px-2.5 py-1 text-sm font-medium text-accent-foreground">
                  {patient.fullName}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPatient(null);
                    setAppt(null);
                    setNotice(null);
                    reset();
                  }}
                >
                  Change
                </Button>
              </div>

              {processing ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Transcribing and drafting the note…
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => void cancelRun()}>
                    <X className="size-3.5" aria-hidden="true" /> Cancel
                  </Button>
                </div>
              ) : recording ? (
                <div className="space-y-3">
                  {liveStream ? <RecordingIndicator stream={liveStream} /> : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="destructive" onClick={stopRecording}>
                      <Square className="size-4" aria-hidden="true" />
                      Stop & generate
                    </Button>
                    {/* Throws the recording away: nothing is sent, no note is made. */}
                    <Button type="button" variant="outline" onClick={cancelRecording}>
                      <X className="size-4" aria-hidden="true" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {canRecord ? (
                    <Button onClick={startRecording}>
                      <Mic className="size-4" aria-hidden="true" />
                      Start recording
                    </Button>
                  ) : null}
                  {canType ? (
                    <Button variant={canRecord ? "outline" : "default"} onClick={startTyping}>
                      <PenLine className="size-4" aria-hidden="true" />
                      Type the note
                    </Button>
                  ) : null}
                  {/* No language to choose (owner's call, 2026-10-24): the server works out
                      Urdu, English or a mix of both (core/ai/scribe-engine, AUTO). */}
                  {canRecord ? (
                    <span className="text-xs text-muted-foreground">
                      Speak in Urdu, English or both. The language is detected automatically.
                    </span>
                  ) : null}
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Drafts you started and never approved.
 *
 * Approve and discard only ever acted on the draft the workspace was holding in
 * memory, so a session that ended early — tab closed, called away mid-review — left
 * a note stranded: it was in the database, it was not in the record, and nothing on
 * screen led back to it. This is that route back. Oldest first, because the one left
 * longest is the one most likely to have been forgotten.
 *
 * Review, not Discard: throwing away a note without reading it should not be a
 * one-click action next to nine others, so the discard button stays inside the
 * review screen where the note is on show.
 */
function PendingApproval({
  drafts,
  onResume,
  resuming,
  disabled,
}: {
  drafts: PendingDraft[];
  onResume: (visitId: string) => void;
  /** The draft currently being fetched, so only its own button shows a spinner. */
  resuming: string | null;
  disabled: boolean;
}) {
  if (drafts.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileClock className="size-4 text-warning-text" aria-hidden="true" />
          Pending approval
        </CardTitle>
        <CardDescription>
          {drafts.length === 1
            ? "A note you recorded but never approved. It is not in the patient's record yet."
            : `${drafts.length} notes you recorded but never approved. They are not in the patients' records yet.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {drafts.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{d.patientName}</span>
              <span className="flex items-center gap-3">
                <span className="hidden text-muted-foreground sm:inline">
                  {d.visitDate ? d.visitDate.toLocaleDateString() : ""}
                </span>
                <Button
                  variant="outline"
                  onClick={() => onResume(d.id)}
                  disabled={disabled}
                >
                  {resuming === d.id ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Opening…
                    </>
                  ) : (
                    <>
                      {/* Every row's button would otherwise be named "Review", which
                          tells a screen reader nothing about which note it opens. */}
                      Review<span className="sr-only"> {d.patientName}&apos;s note</span>
                    </>
                  )}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Drafts dictated by someone who can no longer log in (delta D-18) — shown only to a
 * caller holding `handover:view`.
 *
 * A SEPARATE card from "Pending approval", never merged into it. Approving a note is
 * signing it (ADR-007), and the one thing that must not happen is signing a
 * colleague's clinical judgement while believing it was your own — which is exactly
 * what a single undifferentiated list invites. Hence the different icon, the explicit
 * "you did not dictate this" copy, and the author's name on every row.
 */
function StrandedDrafts({
  drafts,
  onResume,
  resuming,
  disabled,
}: {
  drafts: StrandedDraftItem[];
  onResume: (visitId: string) => void;
  resuming: string | null;
  disabled: boolean;
}) {
  if (drafts.length === 0) return null;
  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserX className="size-4 text-warning-text" aria-hidden="true" />
          Left by a former colleague
        </CardTitle>
        <CardDescription>
          {drafts.length === 1 ? "This note was" : `These ${drafts.length} notes were`}{" "}
          dictated by someone whose account is no longer active, so{" "}
          {drafts.length === 1 ? "it" : "they"} can never be approved by the person who
          recorded {drafts.length === 1 ? "it" : "them"}. Read{" "}
          {drafts.length === 1 ? "it" : "each one"} carefully before approving — your
          name is recorded as approving, theirs stays as who saw the patient.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {drafts.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.patientName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  dictated by {d.authorName ?? "a removed account"}
                  {d.visitDate ? ` · ${d.visitDate.toLocaleDateString()}` : ""}
                </span>
              </span>
              <Button variant="outline" onClick={() => onResume(d.id)} disabled={disabled}>
                {resuming === d.id ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Opening…
                  </>
                ) : (
                  <>
                    Review
                    <span className="sr-only">
                      {" "}
                      {d.patientName}&apos;s note, dictated by{" "}
                      {d.authorName ?? "a removed account"}
                    </span>
                  </>
                )}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
