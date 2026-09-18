"use client";

import { Select } from "@base-ui/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * A themed dropdown — our popup, not the operating system's.
 *
 * A native `<select>` opens an OS list the page cannot style: system-blue
 * highlight, platform fonts, no relation to anything else on screen. This is the
 * Base UI Select the appointment filters, the trash and log filters and the
 * page-size control already use; the markup was copy-pasted into six files
 * before it lived here, which is the whole argument for one component.
 *
 * The trigger is deliberately the same shell as `Input` (height, border, radius,
 * focus ring), so a dropdown sits in a row of fields without announcing itself.
 * `className` sets the width — callers know what has to fit; fix it rather than
 * letting it re-measure, or the control jumps as the selection changes.
 *
 * Use a native `<select>` instead where the list is long and unremarkable (an
 * hour, a minute): the OS list scrolls better on a phone and types-ahead for
 * free. This is for the short, meaningful choice.
 */
export function SelectField<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  id,
  className,
  align = "start",
  popupClassName,
  disabled,
}: {
  value: T;
  onValueChange: (next: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
  id?: string;
  /** Width and any layout classes for the trigger. */
  className?: string;
  align?: "start" | "end";
  popupClassName?: string;
  disabled?: boolean;
}) {
  // Base UI renders the SELECTED label from this map, so the trigger shows a
  // label rather than the stored code.
  const items = Object.fromEntries(options.map((o) => [o.value, o.label]));

  return (
    <Select.Root
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onValueChange(((next as T | null) ?? value) as T)}
    >
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          // Height and focus treatment track `Input` exactly — the docblock above says the
          // trigger is the same shell as a field, and it stopped being true the moment
          // the input grew to 36px.
          "inline-flex h-9 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 data-[popup-open]:border-ring disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <Select.Value className="truncate" />
        <Select.Icon>
          <ChevronsUpDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        {/* Above a dialog (z-100), like the date picker: a dropdown opened inside
            a modal must not render behind it. */}
        <Select.Positioner side="bottom" align={align} sideOffset={4} className="z-[110]">
          <Select.Popup
            className={cn(
              "z-[110] min-w-[var(--anchor-width)] rounded-xl border border-border/70 bg-elevated p-1 text-popover-foreground elev-3 outline-none",
              popupClassName,
            )}
          >
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  <Select.ItemIndicator>
                    <Check className="size-3.5" aria-hidden="true" />
                  </Select.ItemIndicator>
                </span>
                <Select.ItemText>{o.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
