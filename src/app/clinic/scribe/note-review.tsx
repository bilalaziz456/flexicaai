"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/core/ui/button";
import { Textarea } from "@/core/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/core/ui/card";
import { NoteEditor } from "@/core/ui/note-editor";
import { DictationPlayer } from "@/core/ui/dictation-player";
import { clinicalUiFor } from "@/config/clinical-record-ui";
import {
  approveWaitingNote,
  discardReturnedNote,
  resubmitNote,
  sendNoteBack,
} from "@/app/clinic/scribe/actions";

export type NoteToReview = {
  visitId: string;
  mode: "approve" | "returned";
  note: Record<string, unknown>;
  chart: unknown;
  chartProposed: boolean;
  reviewNote: string | null;
  transcript: string | null;
  hasAudio: boolean;
  drugWarnings: string[];
  allergyWarnings: string[];
  patient: { id: string; fullName: string };
  /** Who wrote it (approve mode) or whose patient it is (returned mode). */
  otherName: string;
};

/**
 * A note written for another doctor's patient (owner, 2026-11-14). In `approve` mode
 * the patient's doctor reads it, may edit it, and approves it — only then does it
 * become the record, with its chart change, prescription and recall — or sends it
 * back saying why. In `returned` mode its writer sees why, corrects it and sends it
 * again, or discards it.
 */
export function NoteReview({ item, modulesEnabled }: { item: NoteToReview; modulesEnabled: string[] }) {
  const router = useRouter();
  const clinicalUi = clinicalUiFor(modulesEnabled);
  const [note, setNote] = useState(item.note);
  const [chart, setChart] = useState<unknown>(item.chart ?? {});
  // The chart goes with the note only when the writer proposed a change or it was
  // edited here — otherwise the patient's chart is left exactly as it is.
  const [chartBaseline] = useState(() => JSON.stringify(item.chart ?? {}));
  const chartToSend = () =>
    clinicalUi && (item.chartProposed || JSON.stringify(chart) !== chartBaseline) ? chart : undefined;
  const [reason, setReason] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const approve = item.mode === "approve";

  function done() {
    router.replace("/clinic/scribe");
    router.refresh();
  }

  function run(fn: () => Promise<{ ok: true } | { error: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if ("error" in r) setError(r.error);
      else done();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {approve ? `Approve note: ${item.patient.fullName}` : `Sent back: ${item.patient.fullName}`}
        </CardTitle>
        <CardDescription>
          {approve
            ? `${item.otherName} wrote this note for your patient. It becomes part of the record — with its chart change, prescription and recall — only when you approve it. Edit anything first, or send it back saying what to change.`
            : `${item.otherName} sent this note back. Correct it and send it again, or discard it.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!approve && item.reviewNote ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-medium">What to change</p>
            <p className="mt-1 whitespace-pre-wrap">{item.reviewNote}</p>
          </div>
        ) : null}

        {item.allergyWarnings.length > 0 ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-text">
            <p className="font-semibold">⚠ Allergy conflict. Review before prescribing:</p>
            <ul className="mt-1 list-inside list-disc">
              {item.allergyWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {item.drugWarnings.length > 0 ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-medium">These drugs are not in the formulary:</p>
            <p className="text-muted-foreground">{item.drugWarnings.join(", ")}</p>
          </div>
        ) : null}

        {item.hasAudio ? <DictationPlayer src={`/api/clinical/visit-audio/${item.visitId}`} /> : null}
        {item.transcript ? (
          <details className="rounded-md border well p-3 text-sm">
            <summary className="cursor-pointer font-medium">Transcript</summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{item.transcript}</p>
          </details>
        ) : null}

        <NoteEditor note={note} onChange={setNote} />

        {clinicalUi ? (
          <div className="space-y-2 rounded-lg border well p-3">
            <p className="text-sm font-medium">Tooth chart</p>
            <p className="text-xs text-muted-foreground">
              {approve
                ? "As the note proposes it. It is saved to the patient's chart when you approve."
                : "Saved to the patient's chart once the note is approved."}
            </p>
            <clinicalUi.VisitEditor value={chart} onChange={setChart} />
          </div>
        ) : null}

        {sendingBack ? (
          <div className="space-y-2">
            <label htmlFor="send-back-reason" className="text-sm font-medium">
              What should be changed?
            </label>
            <Textarea
              id="send-back-reason"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Tooth 36, not 46. Add the dose for amoxicillin."
            />
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {approve ? (
            sendingBack ? (
              <>
                <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => run(() => sendNoteBack(item.visitId, reason))}>
                  {pending ? "Sending…" : "Send back"}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setSendingBack(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button disabled={pending} onClick={() => run(() => approveWaitingNote(item.visitId, note, chartToSend()))}>
                  {pending ? "Saving…" : "Approve & save"}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setSendingBack(true)}>
                  Send back
                </Button>
                <Button variant="ghost" disabled={pending} onClick={done}>
                  Later
                </Button>
              </>
            )
          ) : (
            <>
              <Button disabled={pending} onClick={() => run(() => resubmitNote(item.visitId, note, chartToSend()))}>
                {pending ? "Sending…" : "Send again"}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => run(() => discardReturnedNote(item.visitId))}>
                Discard
              </Button>
              <Button variant="ghost" disabled={pending} onClick={done}>
                Later
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
