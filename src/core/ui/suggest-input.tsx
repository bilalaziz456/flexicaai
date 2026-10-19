"use client";

import { useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { cn } from "@/core/lib/utils";

export type Suggestion = { value: string; label?: string };

/** The app's Input look (core/ui/input.tsx), so this reads as the same field. */
const inputCls =
  "h-9 w-full min-w-0 rounded-lg border border-input bg-[var(--input-bg)] px-3 py-1 text-base transition-[color,box-shadow,border-color] duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 md:text-sm";

/**
 * A text field that SUGGESTS as you type, in the app's own popup — the browser's
 * <datalist> could not be themed, so its list looked like part of another program
 * (owner's report, 2026-10-20). Any text is still accepted: a suggestion only saves
 * typing. Picking one puts its `value` in the field; its `label` is the grey line
 * that says what it is, and is searched too, so "amoxicillin" finds "Augmentin".
 *
 * Controlled with `value` + `onChange`, or uncontrolled with `defaultValue` + `name`
 * (a hidden input carries it, for a plain form). Built on Base UI's Autocomplete,
 * the sibling of the Combobox SearchableSelect uses, with the same popup styling.
 */
export function SuggestInput({
  value: controlled,
  defaultValue = "",
  onChange,
  suggestions,
  name,
  id,
  placeholder,
  ariaLabel,
  className,
  required,
  maxLength,
  invalid,
  autoFocus,
  limit = 50,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  suggestions: readonly Suggestion[];
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  required?: boolean;
  maxLength?: number;
  invalid?: boolean;
  autoFocus?: boolean;
  /** How many matches to show at once — a long list is narrowed by typing. */
  limit?: number;
}) {
  const [inner, setInner] = useState(defaultValue);
  const value = controlled ?? inner;
  const set = (v: string) => {
    if (controlled === undefined) setInner(v);
    onChange?.(v);
  };

  return (
    <>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Autocomplete.Root
        items={suggestions as Suggestion[]}
        value={value}
        onValueChange={(v) => set(String(v ?? ""))}
        itemToStringValue={(item) => (item as Suggestion).value}
        filter={(item, query) => {
          const q = query.trim().toLowerCase();
          if (!q) return true;
          const s = item as Suggestion;
          return s.value.toLowerCase().includes(q) || Boolean(s.label?.toLowerCase().includes(q));
        }}
        limit={limit}
        openOnInputClick
      >
        <Autocomplete.Input
          id={id}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          required={required}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoComplete="off"
          className={cn(inputCls, className)}
        />
        <Autocomplete.Portal>
          {/* Above a dialog (z-100), like SelectField and SearchableSelect. */}
          <Autocomplete.Positioner side="bottom" align="start" sideOffset={4} className="z-[110]">
            {/* Hidden when nothing matches: a free-text field has nothing to say about
                that — whatever is typed is still accepted. */}
            <Autocomplete.Popup className="z-[110] w-[var(--anchor-width)] min-w-64 max-w-[var(--available-width)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none [&:not(:has([role=option]))]:hidden">
              <Autocomplete.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1">
                {(item: Suggestion) => (
                  <Autocomplete.Item
                    key={item.value}
                    value={item}
                    className="flex cursor-default select-none flex-col rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                  >
                    <span className="truncate font-medium">{item.value}</span>
                    {item.label ? (
                      <span className="truncate text-xs text-muted-foreground">{item.label}</span>
                    ) : null}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
    </>
  );
}
