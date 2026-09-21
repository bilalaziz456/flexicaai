"use client";

import { useState } from "react";
import { Dialog } from "@/core/ui/dialog";
import type { VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/core/ui/button";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

/**
 * Reusable confirmation modal — CORE. A styled in-app replacement for the browser
 * `confirm()` popup: click the trigger → a modal opens asking to confirm/cancel an
 * action. Unlike {@link ConfirmDeleteDialog} it takes NO password — use it for
 * consequential-but-reversible actions (suspend, deactivate, cancel, undo, void…).
 *
 * Built on the shared `Dialog` (which wraps Base UI), so focus is trapped inside, moved
 * in on open and RESTORED to the trigger on close, background scroll is locked, and
 * Escape / backdrop click dismiss — none of which a hand-rolled portal gets right
 * (a11y: WCAG 2.4.3).
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

      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title={title}
        description={description}
        // While the action is running there is no safe way out, so the corner close
        // is withheld rather than offered and then ignored by `handleOpenChange`.
        dismissible={!pending}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant={confirmVariant} onClick={confirm} disabled={pending}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </>
        }
      >
        {error ? (
          <p className="text-sm text-destructive-text" role="alert">
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
