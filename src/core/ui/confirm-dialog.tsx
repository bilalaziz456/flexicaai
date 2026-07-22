"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/core/ui/button";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

/**
 * Reusable confirmation modal — CORE. A styled in-app replacement for the browser
 * `confirm()` popup: click the trigger → a modal opens asking to confirm/cancel an
 * action. Unlike {@link ConfirmDeleteDialog} it takes NO password — use it for
 * consequential-but-reversible actions (suspend, deactivate, cancel, …). For
 * destructive/irreversible deletes use ConfirmDeleteDialog (password step-up).
 */
export function ConfirmDialog({
  triggerLabel,
  triggerIcon,
  triggerVariant = "outline",
  triggerClassName,
  triggerDisabled,
  title,
  description,
  confirmLabel = "Confirm",
  confirmVariant = "default",
  onConfirm,
}: {
  triggerLabel: string;
  triggerIcon?: React.ReactNode;
  triggerVariant?: ButtonVariant;
  triggerClassName?: string;
  triggerDisabled?: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  /** Runs the action. Return an error to keep the dialog open and show it. */
  onConfirm: () => Promise<{ error?: string } | void>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function close() {
    setOpen(false);
    setError(null);
    setPending(false);
  }

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm();
      if (result?.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      close(); // success — the action revalidated (or redirected)
    } catch {
      // A server redirect throws here — navigation happens, treat as success.
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size="sm"
        className={triggerClassName}
        disabled={triggerDisabled}
        aria-label={triggerLabel}
        onClick={() => setOpen(true)}
      >
        {triggerIcon}
        <span className={triggerIcon ? "hidden md:inline" : undefined}>
          {triggerLabel}
        </span>
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-black/50"
                onClick={close}
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl border bg-card p-5 shadow-xl"
              >
                <h2 className="text-base font-semibold break-words">{title}</h2>
                <p className="mt-1 text-sm break-words text-muted-foreground">
                  {description}
                </p>

                {error ? (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant={confirmVariant}
                    onClick={confirm}
                    disabled={pending}
                  >
                    {pending ? "Working…" : confirmLabel}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
