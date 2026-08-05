"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Eye, EyeOff } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { Button, buttonVariants } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];

/**
 * Reusable step-up delete confirmation — CORE. Every delete in the app funnels
 * through this: click the trigger → a modal opens that both CONFIRMS the delete
 * and requires the signed-in user to re-type their password. The action
 * (`onConfirm`) re-verifies that password server-side before deleting.
 *
 * Built on Base UI `Dialog` (modal): focus is trapped + restored to the trigger on
 * close, background scroll is locked, Escape / backdrop dismiss (WCAG 2.4.3). The
 * password field is hardened against browser / password-manager autofill — the user
 * must actually type it: `type="text"` (never `password`) masked via CSS, a
 * non-standard field name, manager-ignore data attributes, and a readOnly-until-focus
 * toggle that stops Chrome filling it on open.
 */
export function ConfirmDeleteDialog({
  triggerLabel,
  triggerIcon,
  triggerVariant = "ghost",
  triggerClassName,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: {
  triggerLabel: string;
  /** When given, the trigger shows this icon; the text label collapses on mobile. */
  triggerIcon?: React.ReactNode;
  triggerVariant?: ButtonVariant;
  triggerClassName?: string;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Re-verifies the password server-side, then deletes. Return an error to keep the dialog open. */
  onConfirm: (password: string) => Promise<{ error?: string } | void>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [readonly, setReadonly] = useState(true); // blocks autofill-on-open
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setPassword("");
    setShow(false);
    setReadonly(true);
    setError(null);
    setPending(false);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return; // don't let a backdrop/Escape close mid-delete
    setOpen(next);
    if (!next) reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(password);
      if (result?.error) {
        setError(result.error);
        setPending(false);
        return;
      }
      setOpen(false); // success — the action revalidated (or redirected)
      reset();
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

            <form onSubmit={submit} autoComplete="off" className="mt-4 space-y-2">
              <Label htmlFor="reauth-password" className="text-sm">
                Enter your password to confirm
              </Label>
              {/* A TEXT field (never type="password"), so no browser or password
                  manager treats it as a login field — no saved-password
                  suggestions/autofill. Masked via CSS; the eye toggles it. */}
              <div className="relative">
                <Input
                  id="reauth-password"
                  name="klenic-confirm-secret"
                  type="text"
                  value={password}
                  onChange={(e) => {
                    setError(null);
                    setPassword(e.target.value);
                  }}
                  autoFocus
                  readOnly={readonly}
                  onFocus={() => setReadonly(false)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore=""
                  data-bwignore=""
                  data-form-type="other"
                  // Inline style (not a CSS class) so toggling repaints reliably
                  // in Chrome. type stays "text" → no password autofill.
                  style={
                    {
                      WebkitTextSecurity: show ? "none" : "disc",
                    } as React.CSSProperties
                  }
                  className="h-9 pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  tabIndex={-1}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center rounded-md px-2.5 text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:text-foreground"
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={pending || !password}>
                  {pending ? "Deleting…" : confirmLabel}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
