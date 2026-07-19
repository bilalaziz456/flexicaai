"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import { Label } from "@/core/ui/label";

/**
 * SearchableSelect — a themed Base UI combobox using the "input-inside-popup"
 * pattern: the TRIGGER looks and behaves like a normal dropdown (shows the selected
 * value + chevron, not an editable text box), and the search box lives INSIDE the
 * opened panel, starting empty every time. So a non-technical user just clicks and
 * picks — or types to filter if the list is long — and there is never any pre-filled
 * text to clear. CORE, generic. Use for entity pickers (doctor, patient, procedure,
 * category); keep plain `<select>` for short fixed enums (method, status, period…).
 *
 * Controlled by `value` (the option's `value`) + `onChange`. Pass `name` to also
 * render a hidden input so the value submits inside a plain form.
 */
export type SelectOption = { value: string; label: string };

const triggerCls =
  "inline-flex h-8 items-center justify-between gap-1.5 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-2 text-left text-sm outline-none transition-colors hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:border-ring data-[placeholder]:text-muted-foreground";

export function SearchableSelect({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  name,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className,
}: {
  label?: string;
  ariaLabel: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** When set, a hidden input carries the value so it submits inside a plain form. */
  name?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? <Label className="text-xs font-normal text-muted-foreground">{label}</Label> : null}
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Combobox.Root
        items={options}
        value={selected}
        onValueChange={(item) => onChange((item as SelectOption | null)?.value ?? "")}
        isItemEqualToValue={(a, b) =>
          (a as SelectOption).value === (b as SelectOption).value
        }
      >
        {/* The trigger is a button that looks like a plain dropdown. */}
        <Combobox.Trigger
          type="button"
          aria-label={ariaLabel}
          className={`${triggerCls} ${className ?? "w-44"}`}
        >
          <Combobox.Value placeholder={placeholder} />
          <Combobox.Icon>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
          </Combobox.Icon>
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
            <Combobox.Popup className="z-50 flex max-h-80 w-[var(--anchor-width)] min-w-44 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none [&_[role=status]]:sr-only">
              {/* Search box lives INSIDE the popup, empty on every open. */}
              <div className="border-b p-1">
                <Combobox.Input
                  placeholder={searchPlaceholder}
                  className="h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <Combobox.Empty className="px-3 py-4 text-sm text-muted-foreground">
                No matches.
              </Combobox.Empty>
              <Combobox.List className="min-h-0 flex-1 overflow-y-auto p-1">
                {(item: SelectOption) => (
                  <Combobox.Item
                    key={item.value}
                    value={item}
                    className="flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      <Combobox.ItemIndicator>
                        <Check className="size-3.5" aria-hidden="true" />
                      </Combobox.ItemIndicator>
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
