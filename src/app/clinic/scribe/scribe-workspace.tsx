"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { SelectField } from "@/core/ui/select-field";
import { DictationPlayer } from "@/core/ui/dictation-player";
import { RecordingIndicator } from "@/app/clinic/scribe/recording-indicator";
import { SCRIBE_LANGUAGES, asScribeLanguage } from "@/core/ai/scribe-language";

const LANGUAGE_KEY = "flexica-scribe-language";
const noSubscribe = () => () => {};
function readSavedLanguage(): string {
  try {
    return asScribeLanguage(localStorage.getItem(LANGUAGE_KEY)) ?? "";
  } catch {
    return "";
  }
}
import { FileClock, Loader2, Mic, Square, UserX } from "lucide-react";
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
import {
  approveVisit,
  discardDraft,
  loadDraft,
  loadPatientChart,
  searchPatients,
  getScribeStatus,
} from "@/app/clinic/scribe/actions";

type Patient = { id: string; fullName: string; phone: string | null };
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
 * The voice scribe (CLAUDE.md §8). Client component (browser MediaRecorder):
 * pick a patient → record → the /api/ai/scribe route transcribes + drafts a
 * note → the doctor reviews/edits → Approve saves it. Every note is a DRAFT
 * until the doctor approves; nothing is auto-finalized.
 */
export function ScribeWorkspace({
  initialPatients,
  pendingDrafts = [],
  strandedDrafts = [],
  modulesEnabled = [],
}: {
  initialPatients: Patient[];
  /** Your own drafts that were never approved — see PendingApproval below. */
  pendingDrafts?: PendingDraft[];
  /** Someone ELSE's drafts, reachable only via `handover` — see StrandedDrafts. */
  strandedDrafts?: StrandedDraftItem[];
  /** The clinic's enabled modules — drives the specialty chart editor (if any). */
  modulesEnabled?: string[];
}) {
  const clinicalUi = clinicalUiFor(modulesEnabled);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [results, setResults] = useState<Patient[]>(initialPatients);
  const [query, setQuery] = useState("");

  const [recording, setRecording] = useState(false);
  // The microphone stream while recording, for the live level display.
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  // The dictation language, remembered per device: read as an external value (the
  // server renders without it) and overridden by a choice made in this session.
  const savedLanguage = useSyncExternalStore(noSubscribe, readSavedLanguage, () => "");
  const [pickedLanguage, setPickedLanguage] = useState<string | null>(null);
  const language = pickedLanguage ?? savedLanguage;
  const chooseLanguage = (v: string) => {
    setPickedLanguage(v);
    try {
      localStorage.setItem(LANGUAGE_KEY, v);
    } catch {
      // Storage blocked: the choice still holds for this session.
    }
  };
  const [processing, setProcessing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState<Record<string, unknown>>({});
  // The specialty chart the doctor confirms (e.g. odontogram). It starts as the
  // patient's CURRENT chart and is saved only if the doctor changes it (owner's call,
  // 2026-10-24) — a misheard dictation must not quietly re-mark a tooth. What the note
  // suggests is offered as one click instead (`chartSuggestion`), never pre-applied.
  const [chart, setChart] = useState<unknown>(null);
  const [chartBaseline, setChartBaseline] = useState<string>("null");
  const [chartSuggestion, setChartSuggestion] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function reset() {
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
        const blob = new Blob(chunksRef.current, {
          type: mime || "audio/webm",
        });
        void submitAudio(blob);
      };
      recorderRef.current = recorder;
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

  async function submitAudio(blob: Blob) {
    if (!patient) return;
    setProcessing(true);
    setError(null);
    try {
      const ext = blob.type.includes("webm") ? "webm" : "wav";
      const form = new FormData();
      form.append("audio", blob, `recording.${ext}`);
      form.append("patientId", patient.id);
      if (language) form.append("language", language);
      const res = await fetch("/api/ai/scribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Scribe failed.");
        return;
      }
      // The route now ACCEPTS the recording and returns 202 (delta D-08): the audio is
      // stored and the visit exists, but the note is still being written. Wait for it.
      await waitForDraft(data.visitId as string);
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
      const s = await getScribeStatus(visitId);
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
    if (!draft) return;
    setError(null);
    startTransition(async () => {
      // The chart goes with the approval only when the doctor changed it; otherwise
      // the patient's chart is left exactly as it was.
      const chartChanged = clinicalUi && JSON.stringify(chart) !== chartBaseline;
      const r = await approveVisit(draft.visitId, note, chartChanged ? chart : undefined);
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
          <CardTitle>Review draft: {patient?.fullName}</CardTitle>
          <CardDescription>
            AI-generated draft. Edit anything, then approve to save. Nothing is
            saved to the record until you approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft.allergyWarnings && draft.allergyWarnings.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-text">
              <p className="font-semibold">⚠ Allergy conflict. Review before prescribing:</p>
              <ul className="mt-1 list-inside list-disc">
                {draft.allergyWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.drugWarnings.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">These drugs are not in the formulary:</p>
              <p className="text-muted-foreground">{draft.drugWarnings.join(", ")}</p>
            </div>
          )}

          {/* Listen back when the text looks wrong (2026-10-20). */}
          <DictationPlayer src={`/api/clinical/visit-audio/${draft.visitId}`} />

          <details className="rounded-md border well p-3 text-sm">
            <summary className="cursor-pointer font-medium">Transcript</summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {draft.transcript}
            </p>
          </details>

          <NoteEditor note={note} onChange={setNote} />

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
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPatient(null);
                    reset();
                  }}
                >
                  Change
                </Button>
              </div>

              {processing ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Transcribing and drafting the note…
                </div>
              ) : recording ? (
                <div className="space-y-3">
                  {liveStream ? <RecordingIndicator stream={liveStream} /> : null}
                  <Button variant="destructive" onClick={stopRecording}>
                    <Square className="size-4" aria-hidden="true" />
                    Stop & generate
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={startRecording}>
                    <Mic className="size-4" aria-hidden="true" />
                    Start recording
                  </Button>
                  {/* Telling speech-to-text the language beats letting it guess
                      (core/ai/scribe-language.ts); remembered on this device. */}
                  <SelectField
                    value={language}
                    onValueChange={(v) => chooseLanguage(v ?? "")}
                    options={[
                      { value: "", label: "Language: detect" },
                      ...SCRIBE_LANGUAGES.map((l) => ({ value: l.code, label: `Language: ${l.label}` })),
                    ]}
                    ariaLabel="Dictation language"
                    className="h-9 w-auto"
                  />
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
