"use client";

import { useActionState, useState, useTransition } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { ActionForm } from "@/core/ui/action-form";
import { Button, buttonVariants } from "@/core/ui/button";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { toast, useActionToast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";
import {
  removeClinicLetterhead,
  setLetterheadMargins,
  uploadClinicLetterhead,
  type AdminActionState,
} from "@/app/admin/actions";

type Margins = { top: number; bottom: number; left: number; right: number };

const SIDES: { key: keyof Margins; label: string; max: number }[] = [
  { key: "top", label: "Top", max: 150 },
  { key: "bottom", label: "Bottom", max: 150 },
  { key: "left", label: "Left", max: 60 },
  { key: "right", label: "Right", max: 60 },
];

/**
 * The clinic's letterhead (owner's call, 2026-10-14): the account manager uploads the
 * clinic's own blank A4 letterhead and sets four margins — how much of the top, bottom
 * and sides the letterhead's design uses — so the prescription is written in the space
 * left. Every clinic's design differs, so the preview beside the margins shows a sample
 * prescription on THIS letterhead with the margins as typed, before they are saved.
 */
export function ClinicLetterheadForm({
  clinicId,
  hasLetterhead,
  margins,
  version,
}: {
  clinicId: string;
  hasLetterhead: boolean;
  margins: Margins;
  /** Changes whenever the clinic is saved, so the preview reloads a new letterhead. */
  version: number;
}) {
  const [m, setM] = useState<Margins>(margins);
  // The preview follows the inputs, but only once typing pauses (each change re-renders
  // a PDF on the server).
  const [shown, setShown] = useState<Margins>(margins);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const change = (key: keyof Margins, raw: string) => {
    const v = Math.max(0, Math.min(SIDES.find((s) => s.key === key)!.max, Number(raw.replace(/[^\d]/g, "")) || 0));
    const next = { ...m, [key]: v };
    setM(next);
    if (timer) clearTimeout(timer);
    setTimer(setTimeout(() => setShown(next), 600));
  };

  const [upState, upAction, uploading] = useActionState<AdminActionState, FormData>(
    uploadClinicLetterhead.bind(null, clinicId),
    {},
  );
  useActionToast(upState, { saved: "Letterhead uploaded.", error: true });
  const [mState, mAction, savingMargins] = useActionState<AdminActionState, FormData>(
    setLetterheadMargins.bind(null, clinicId),
    {},
  );
  useActionToast(mState, { saved: "Margins saved.", error: true });
  const [fileName, setFileName] = useState("");
  const [removing, startRemove] = useTransition();

  const previewSrc = `/api/admin/clinics/${clinicId}/letterhead-preview?top=${shown.top}&bottom=${shown.bottom}&left=${shown.left}&right=${shown.right}&v=${version}`;
  const dirty = SIDES.some((s) => m[s.key] !== margins[s.key]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <ActionForm action={upAction} state={upState} className="space-y-2">
          <Label>Letterhead (blank A4 · PDF, PNG or JPG · up to 5 MB)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="letterhead-file" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}>
              <Paperclip className="size-4" aria-hidden="true" /> {hasLetterhead ? "Replace letterhead" : "Choose letterhead"}
            </label>
            <input
              id="letterhead-file"
              name="letterhead"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? "")}
            />
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {fileName || (hasLetterhead ? "Letterhead uploaded" : "None — prescriptions use a plain header")}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={uploading || !fileName}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            {hasLetterhead ? (
              <ConfirmDialog
                triggerLabel="Remove"
                triggerIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                triggerVariant="ghost"
                triggerDisabled={removing}
                title="Remove the letterhead?"
                description="Prescriptions will print with a plain header (the clinic's name and address) until a new one is uploaded."
                confirmLabel="Remove"
                confirmVariant="destructive"
                cancelLabel="Keep"
                onConfirm={async () => {
                  let err: string | undefined;
                  await new Promise<void>((done) =>
                    startRemove(async () => {
                      const r = await removeClinicLetterhead(clinicId);
                      err = r.error;
                      done();
                    }),
                  );
                  if (err) return { error: err };
                  toast.success("Letterhead removed.");
                }}
              />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Scan or export the clinic&apos;s blank letterhead as a full A4 page. It is drawn behind every
            prescription exactly as uploaded.
          </p>
        </ActionForm>

        <ActionForm action={mAction} state={mState} className="space-y-2">
          <Label>Where the writing goes (millimetres)</Label>
          <p className="text-xs text-muted-foreground">
            Millimetres the letterhead&apos;s design takes at each edge — a tall header needs a bigger top
            margin, a thin footer a smaller bottom one. The preview updates as you type.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SIDES.map((s) => (
              <div key={s.key} className="space-y-1">
                <Label htmlFor={`lh-${s.key}`} className="whitespace-nowrap text-xs text-muted-foreground">
                  {s.label}
                </Label>
                <Input
                  id={`lh-${s.key}`}
                  name={s.key}
                  inputMode="numeric"
                  value={String(m[s.key])}
                  onChange={(e) => change(s.key, e.target.value)}
                  className="h-9"
                />
              </div>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={savingMargins || !dirty}>
            {savingMargins ? "Saving…" : "Save margins"}
          </Button>
        </ActionForm>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Preview — a sample prescription</p>
        {/* Our own route, framed by our own page only (src/proxy.ts). Keyed on the margins
            so each change loads the new PDF. */}
        <iframe
          key={previewSrc}
          src={`${previewSrc}#toolbar=0&navpanes=0&view=FitH`}
          title="Letterhead preview"
          className="aspect-[210/297] w-full rounded-md border bg-white"
        />
      </div>
    </div>
  );
}
