"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/core/lib/utils";

/**
 * An on/off control for something that takes effect immediately.
 *
 * The distinction from a checkbox is not cosmetic and is worth keeping: a checkbox is
 * a value you are about to SUBMIT, a switch is a state you are CHANGING now. This app
 * has a dozen settings toggles drawn as checkboxes for want of this component.
 *
 * A switch in a Server Action form still needs `ref={syncChecked(v)}` from
 * `checkbox-sync.ts` for the same reason a checkbox does (conventions §5) — React
 * resets the form after the action and restores the first-rendered state.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  name,
  className,
  "aria-label": ariaLabel,
}: {
  checked?: boolean;
  onCheckedChange?: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      name={name}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors duration-200 outline-none",
        "bg-foreground/[0.18] data-[checked]:bg-primary",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="size-4 rounded-full bg-white elev-1 transition-transform duration-200 ease-out data-[checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
