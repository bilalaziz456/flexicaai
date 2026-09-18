"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * A checkbox — CORE. A value you are about to SUBMIT, as opposed to `Switch`, which is
 * a state you are CHANGING now. That distinction is the whole reason both exist.
 *
 * The app had twenty raw `<input type="checkbox">` elements styled with `accent-color`
 * and they did not agree with each other: two different tokens (`--primary` and
 * `--color-primary`) and two sizes. `accent-color` is also a dead end — it cannot
 * carry a focus ring, an indeterminate mark, or a border that reads on a dark ground,
 * so every one of them was a control the design system could not reach.
 *
 * In a Server Action form this still needs `ref={syncChecked(v)}` on a CONTROLLED
 * instance, for the reason conventions §5 gives: React resets the form once the action
 * completes and a reset restores the first-rendered state. Uncontrolled instances
 * (`defaultChecked`) and forms that redirect do not.
 */
export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  indeterminate,
  disabled,
  required,
  id,
  name,
  value,
  ref,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  value?: string;
  /** For `syncChecked` — see the note above. */
  ref?: React.Ref<HTMLInputElement>;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      name={name}
      value={value}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      indeterminate={indeterminate}
      disabled={disabled}
      required={required}
      inputRef={ref}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={cn(
        "inline-flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded-[0.3rem] border border-input bg-[var(--input-bg)] transition-colors outline-none",
        "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
        "data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {indeterminate ? (
          <Minus className="size-3.5" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
