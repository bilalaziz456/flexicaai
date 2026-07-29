"use client";

import { useActionState, useState, useTransition } from "react";
import { uploadClinicLogo, removeClinicLogo, type AdminActionState } from "@/app/admin/actions";
import { MAX_LOGO_BYTES } from "@/core/clinics/logo-limits";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";

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
  const [hasFile, setHasFile] = useState(false);
  const [removing, startRemove] = useTransition();
  const current = preview ?? logo;

  // Validate size on the CLIENT so an oversized file never reaches the server action
  // (which would hit Next's 1 MB body limit and hard-crash instead of erroring nicely).
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && file.size > MAX_LOGO_BYTES) {
      setFileError("Logo is too large — please use an image under 1 MB.");
      setPreview(null);
      setHasFile(false);
      e.target.value = ""; // clear so it can't be submitted
      return;
    }
    setFileError(null);
    setHasFile(Boolean(file));
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Printed at the top of invoices &amp; receipts, as uploaded — a thermal / black-and-white
        printer renders it in B&amp;W automatically. For the cleanest B&amp;W result, upload a
        <span className="font-medium"> black (or transparent) PNG</span>. Under 1 MB. No logo = nothing printed.
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
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp"
          onChange={onPick}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-[var(--input-bg)] file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={pending || !hasFile}>
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
      {state.saved ? <Toast message="Logo saved." /> : null}
    </form>
  );
}
