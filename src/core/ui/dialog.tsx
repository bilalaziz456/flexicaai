"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/core/lib/utils";

/**
 * The modal shell — backdrop, positioning, entrance, header and footer, once.
 *
 * Five files had hand-copied the same three class strings (`fixed inset-0 z-[100]
 * bg-black/50 …` plus a centred popup plus the `data-[starting-style]` pair), so a
 * modal's corner radius or its animation was five edits, and in practice they had
 * already drifted. Everything here is presentation: `DialogPrimitive` still does the
 * focus trap, the Escape handling and the scroll lock, and callers keep passing their
 * own `open` / `onOpenChange`.
 *
 * `size` exists because the two real cases are genuinely different — a confirmation
 * is a sentence and a button, a form is a column of fields — and letting each caller
 * pick its own `max-w-…` is how five copies started.
 */
const sizes = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
} as const;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = "sm",
  footer,
  /** Hides the corner close button — for a dialog that must be answered, not dismissed. */
  dismissible = true,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: keyof typeof sizes;
  footer?: ReactNode;
  dismissible?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Blurred rather than a flat 50% black. Over the tinted ground a plain scrim
            reads as a grey sheet; diffusing what is behind it says "the page is still
            there, you are just not in it", which is what a modal means. */}
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-[hsl(var(--shadow-color)/0.45)] backdrop-blur-[3px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <DialogPrimitive.Popup
          // Publishes the surface a nested `.well` inside the dialog should take
          // (globals.css). A dialog is an elevated plane, so boxes inside it recede.
          data-slot="dialog-popup"
          className={cn(
            "fixed top-1/2 left-1/2 z-[100] flex max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/70 bg-elevated text-card-foreground elev-4 outline-none",
            // Rises very slightly as it arrives rather than only scaling — a scale-only
            // entrance reads as a zoom, a lift reads as something being brought forward.
            "transition-[opacity,transform] duration-200 ease-out data-[ending-style]:translate-y-[calc(-50%+4px)] data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:translate-y-[calc(-50%+8px)] data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0",
            sizes[size],
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-display text-base font-semibold tracking-[-0.015em] break-words">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm break-words text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            {dismissible ? (
              <DialogPrimitive.Close
                aria-label="Close"
                className="-mt-1 -mr-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <X className="size-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            ) : null}
          </div>

          {/* The body scrolls, the header and footer do not: on a phone a long form
              otherwise pushes its own submit button off the bottom of the screen. */}
          {children ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 text-sm">{children}</div>
          ) : null}

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-surface-sunken px-5 py-3.5">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Closes the dialog it is rendered inside — for a caller's own footer buttons. */
export const DialogClose = DialogPrimitive.Close;
