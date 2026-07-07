"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
 * The password field is hardened against browser / password-manager autofill —
 * the user must actually type it: autoComplete off, a non-standard field name,
 * the manager-ignore data attributes, and a readOnly-until-focus toggle that
 * stops Chrome from filling it on open.
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

  function close() {
    setOpen(false);
    setPassword("");
    setShow(false);
    setReadonly(true);
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
                  className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
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
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={pending || !password}>
                  {pending ? "Deleting…" : confirmLabel}
                </Button>
              </div>
              </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
