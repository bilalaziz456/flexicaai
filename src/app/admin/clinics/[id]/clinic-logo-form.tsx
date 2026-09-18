"use client";

import { useActionState, useState, useTransition } from "react";
import { uploadClinicLogo, removeClinicLogo, type AdminActionState } from "@/app/admin/actions";
import { LOGO_MAX_PX, MAX_LOGO_BYTES } from "@/core/clinics/logo-limits";
import { downscaleImage } from "@/core/lib/image-resize";
import { Button, buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { SavedToast } from "@/core/ui/toast";

/**
 * Clinic logo upload (owner/super-admin/account-manager). Shows the current logo (via a
 * served URL) or a locally-picked preview, with Save / Remove. Size is validated on the
 * client so an oversized file never reaches the server action (Next's 1 MB body limit).
 * `logo` is the served image URL (or null).
 */
export function ClinicLogoForm({ clinicId, logo }: { clinicId: string; logo: string | null }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    uploadClinicLogo.bind(null, clinicId),
    {},
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [shrunkFrom, setShrunkFrom] = useState<number | null>(null);
  const [removing, startRemove] = useTransition();
  const [, startSubmit] = useTransition();
  const current = preview ?? logo;

  /**
   * Downscale on pick, THEN check the size — in that order, which is the point.
   * The logo is re-inlined as base64 into every printed invoice and receipt, so a
   * 3000px phone photo costs bytes on every document forever. Shrinking first also
   * means a large upload now succeeds instead of being rejected for the 1 MB cap
   * (Next's Server-Action body limit, which a bigger body would hard-crash into).
   *
   * `downscaleImage` keeps PNG/WebP as-is so TRANSPARENCY survives — the copy below
   * tells admins to upload a transparent PNG for clean thermal printing, and
   * re-encoding that to JPEG would print a black box.
   */
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) {
      setFileError(null);
      setFile(null);
      setPreview(null);
      setShrunkFrom(null);
      return;
    }

    const shrunk = await downscaleImage(picked, {
      maxPx: LOGO_MAX_PX,
      quality: 0.85,
      name: picked.name,
    });
    const finalFile = shrunk ?? picked;

    if (finalFile.size > MAX_LOGO_BYTES) {
      setFileError("Logo is still too large after resizing. Please use a simpler image.");
      setFile(null);
      setPreview(null);
      setShrunkFrom(null);
      e.target.value = ""; // clear so it can't be submitted
      return;
    }

    setFileError(null);
    setFile(finalFile);
    setShrunkFrom(shrunk && shrunk.size < picked.size ? picked.size : null);
    setPreview(URL.createObjectURL(finalFile));
  }

  // The form is submitted by hand because what goes up is the RESIZED file held in
  // state, not whatever is sitting in the file input.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append("logo", file);
    startSubmit(() => action(fd));
  }

  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {/* Opens on the CONSTRAINT, not on where the logo appears — the card's own
          description already says that, and the two sentences ran one under the other
          saying the same thing. What is left is the part that changes what someone
          uploads. */}
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        A thermal or black-and-white printer converts it automatically. For the cleanest
        result upload a <span className="font-medium">black or transparent PNG</span> —
        transparency is preserved. Large images are resized for you; no logo means
        nothing is printed.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current}
            alt="Clinic logo"
            className="max-h-16 max-w-40 rounded border bg-white object-contain p-1"
          />
        ) : (
          <div className="flex h-16 w-40 items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
            No logo
          </div>
        )}
        {/* A file input has no styleable button of its own, so the LABEL is the
            control — the same move as the account avatar picker. The `file:` pseudo
            element it used before could not be made to match a real button's height
            or hover, so this one control sat 30px tall among 36px ones. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer")}>
            {file ? "Choose another" : "Choose file"}
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              onChange={onPick}
              className="sr-only"
            />
          </label>
          {/* The filename has to be shown by us now: `sr-only` takes away the
              browser's own "No file chosen", and a picker that says nothing after a
              pick looks like it did not work. */}
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {file ? file.name : "No file chosen"}
          </span>
        </div>
        {/* Says what happened to their file. Silent resizing of something that gets
            printed on a patient's receipt would be a surprise worth avoiding. */}
        {shrunkFrom && file ? (
          <span className="text-xs text-muted-foreground">
            Resized to {kb(file.size)} (from {kb(shrunkFrom)})
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {/* The primary action of this form, so it takes the primary variant. It was
            `outline`, which put it at the same weight as the picker beside it. */}
        <Button type="submit" size="sm" disabled={pending || !file}>
          {pending ? "Uploading…" : "Save logo"}
        </Button>
        {logo ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={removing}
            onClick={() => startRemove(async () => { await removeClinicLogo(clinicId); })}
          >
            Remove
          </Button>
        ) : null}
        {fileError ? (
          <span className="text-sm text-destructive">{fileError}</span>
        ) : state.error ? (
          <span className="text-sm text-destructive">{state.error}</span>
        ) : null}
      </div>
      <SavedToast state={state} message="Logo saved." />
    </form>
  );
}
