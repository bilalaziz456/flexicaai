"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/core/ui/button";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

/**
 * Reusable confirmation modal — CORE. A styled in-app replacement for the browser
 * `confirm()` popup: click the trigger → a modal opens asking to confirm/cancel an
 * action. Unlike {@link ConfirmDeleteDialog} it takes NO password — use it for
 * consequential-but-reversible actions (suspend, deactivate, cancel, undo, void…).
 *
 * Built on Base UI `Dialog` (modal), so focus is trapped inside, moved in on open and
 * RESTORED to the trigger on close, background scroll is locked, and Escape / backdrop
 * click dismiss — none of which a hand-rolled portal gets right (a11y: WCAG 2.4.3).
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

  function handleOpenChange(next: boolean) {
    if (pending) return; // don't let a backdrop/Escape close mid-action
    setOpen(next);
    if (!next) setError(null);
  }

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
      setPending(false);
      setError(null);
      setOpen(false); // success — the action revalidated (or redirected)
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
        <span className={triggerIcon ? "hidden md:inline" : undefined}>{triggerLabel}</span>
      </Button>

      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/50 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-[100] max-h-[90vh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-5 text-card-foreground shadow-xl outline-none transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Dialog.Title className="text-base font-semibold break-words">{title}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm break-words text-muted-foreground">
              {description}
            </Dialog.Description>

            {error ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" variant={confirmVariant} onClick={confirm} disabled={pending}>
                {pending ? "Working…" : confirmLabel}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
