"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";
import { cn } from "@/core/lib/utils";

export type RadioOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** A second line under the label — what choosing this actually does. */
  hint?: ReactNode;
  disabled?: boolean;
};

/**
 * A one-of-several choice, where seeing the options matters.
 *
 * Three files use raw `<input type="radio">` with their own markup. Beyond looking
 * different on each screen, a native radio cannot show the HINT — and every one of
 * those three cases (an announcement's level, a paper size, a booking's type) is a
 * choice where the consequence needs saying, which is why they are radios and not a
 * dropdown in the first place.
 *
 * `card` draws each option as a selectable surface. Use it when the hints are doing
 * real work; the plain variant when the labels speak for themselves.
 */
export function RadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  name,
  variant = "plain",
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (next: T) => void;
  options: readonly RadioOption<T>[];
  name?: string;
  variant?: "plain" | "card";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <RadioGroupPrimitive
      value={value}
      onValueChange={(next) => onValueChange(((next as T | null) ?? value) as T)}
      name={name}
      aria-label={ariaLabel}
      className={cn("flex flex-col gap-2", className)}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "flex cursor-pointer items-start gap-2.5 text-sm",
            o.disabled && "cursor-not-allowed opacity-50",
            variant === "card" &&
              "rounded-xl border border-border/70 bg-card p-3 transition-[border-color,box-shadow] duration-150 hover:border-border has-data-[checked]:border-primary/60 has-data-[checked]:elev-1",
          )}
        >
          <Radio.Root
            value={o.value}
            disabled={o.disabled}
            className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-[var(--input-bg)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[checked]:border-primary data-[checked]:bg-primary"
          >
            <Radio.Indicator className="size-1.5 rounded-full bg-primary-foreground" />
          </Radio.Root>
          <span className="min-w-0">
            <span className="block font-medium text-foreground">{o.label}</span>
            {o.hint ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>
            ) : null}
          </span>
        </label>
      ))}
    </RadioGroupPrimitive>
  );
}
