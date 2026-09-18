"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import type { ReactNode } from "react";
import { cn } from "@/core/lib/utils";

/**
 * A labelled form control — label, the control, optional help, and the error.
 *
 * There was no such thing. 49 files imported `Label`, 33 more used a raw `<label>`,
 * two pages had each written a private `Field` component with this exact shape, and
 * validation messages were an ad-hoc `<p className="text-destructive-text">` in 77
 * files. So the same field looked slightly different on every screen, and whether it
 * was wired to its input for a screen reader was down to whoever typed it.
 *
 * Base UI's Field does that wiring: the label's `htmlFor`, the description and error
 * as `aria-describedby`, and `aria-invalid` on the control when there is an error. The
 * caller just renders the input.
 *
 * It does NOT validate. Validation is the Server Action's job in this codebase
 * (conventions §4/§5) and this only displays what comes back, so a field cannot start
 * disagreeing with the action that owns the rule.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  /** Puts the label beside the control — for a switch or a single checkbox. */
  inline = false,
  className,
  children,
}: {
  label?: ReactNode;
  /** Point at the control's id when the control is not a direct Base UI child. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  inline?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <FieldPrimitive.Root
      // `invalid` is what drives aria-invalid and the ring on the control.
      invalid={Boolean(error)}
      className={cn(
        inline ? "flex items-center justify-between gap-4" : "flex flex-col gap-1.5",
        className,
      )}
    >
      {label ? (
        <FieldPrimitive.Label
          htmlFor={htmlFor}
          className={cn(
            "text-sm font-medium text-foreground",
            inline && "order-2 flex-1 cursor-pointer",
          )}
        >
          {label}
          {required ? (
            <span className="ml-0.5 text-destructive-text" aria-hidden="true">
              *
            </span>
          ) : null}
          {/* Screen readers get the word, not the glyph — an asterisk read aloud is
              "star", which is not what it means. */}
          {required ? <span className="sr-only"> (required)</span> : null}
        </FieldPrimitive.Label>
      ) : null}

      <div className={cn(inline && "order-1 shrink-0")}>{children}</div>

      {/* Hint is suppressed while an error shows: two lines of small print under one
          input is noise at the exact moment the user needs one clear instruction. */}
      {hint && !error ? (
        <FieldPrimitive.Description className="text-xs text-muted-foreground">
          {hint}
        </FieldPrimitive.Description>
      ) : null}

      {error ? (
        <FieldPrimitive.Error
          match={true}
          className="text-xs font-medium text-destructive-text"
        >
          {error}
        </FieldPrimitive.Error>
      ) : null}
    </FieldPrimitive.Root>
  );
}
