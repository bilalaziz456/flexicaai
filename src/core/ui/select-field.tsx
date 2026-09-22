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
  defaultValue,
  onValueChange,
  options,
  ariaLabel,
  id,
  name,
  required,
  className,
  align = "start",
  popupClassName,
  disabled,
  size = "default",
}: {
  /** Controlled. Omit and pass `defaultValue` for a plain form field. */
  value?: T;
  /** Uncontrolled starting value — for a `name`d field in a Server Action form. */
  defaultValue?: T;
  onValueChange?: (next: T) => void;
  /** `disabled` greys an option OUT rather than hiding it — the label can then say
   *  why it is unavailable, which a missing row cannot. */
  options: readonly { value: T; label: string; disabled?: boolean }[];
  ariaLabel: string;
  id?: string;
  /**
   * Submits with the form under this key. Base UI keeps a hidden input in step, so
   * the value reaches a Server Action exactly as a native `<select name>` would.
   *
   * This is what the component was MISSING, and it is why twenty-two form fields
   * were still native `<select>`: a primitive that only did the controlled case left
   * every ordinary form with no option but to hand-roll one.
   */
  name?: string;
  required?: boolean;
  /** Width and any layout classes for the trigger. */
  className?: string;
  align?: "start" | "end";
  popupClassName?: string;
  disabled?: boolean;
  /**
   * `sm` is for a control INSIDE a table row. A field-height select in a row makes
   * the row as tall as a form field, which is how a dense list turns into a stack
   * of cards — the same reason the button system keeps xs and sm sizes.
   */
  size?: "default" | "sm";
}) {
  // Base UI renders the SELECTED label from this map, so the trigger shows a
  // label rather than the stored code.
  const items = Object.fromEntries(options.map((o) => [o.value, o.label]));

  return (
    <Select.Root
      items={items}
      // Controlled and uncontrolled are mutually exclusive in React, so only ONE of
      // these may be defined — passing `value: undefined` alongside a defaultValue
      // still counts as controlled and pins the select to nothing.
      {...(value !== undefined ? { value } : { defaultValue })}
      name={name}
      required={required}
      disabled={disabled}
      onValueChange={(next) => onValueChange?.(((next as T | null) ?? value) as T)}
    >
      <Select.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          // Height and focus treatment track `Input` exactly — the docblock above says the
          // trigger is the same shell as a field, and it stopped being true the moment
          // the input grew to 36px.
          "inline-flex items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 data-[popup-open]:border-ring disabled:pointer-events-none disabled:opacity-50",
          size === "sm" ? "h-7 px-2.5 text-[0.8rem]" : "h-9 px-3 text-sm",
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
              "z-[110] min-w-[var(--anchor-width)] rounded-xl border border-border/70 bg-popover p-1 text-popover-foreground elev-3 outline-none",
              popupClassName,
            )}
          >
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
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

/**
 * The field shell for a select we keep NATIVE on purpose.
 *
 * `SelectField` above is for the short, meaningful choice. A long, unremarkable list —
 * an hour, a minute, a month — is genuinely better as the operating system's own list:
 * it scrolls properly on a phone and types ahead for free. Those selects still have to
 * look like every other field, and ten files had each kept their own copy of these
 * classes to achieve that, which is the duplication this file exists to end. One copy,
 * here, beside the rule that says when to reach for it.
 */
export const nativeSelectClass =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 select-chevron";
