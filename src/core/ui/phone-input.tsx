"use client";

import { useState } from "react";
import { Input } from "@/core/ui/input";
import { sanitisePhoneInput } from "@/core/lib/phone";

/**
 * A phone field that can only ever hold a phone number.
 *
 * It sanitises as you type rather than rejecting on submit: pasting
 * "+92 345-018 6120" out of a chat is a perfectly good number, and refusing it
 * teaches people the form is fussy without making the stored data any cleaner. The
 * spaces and dashes are simply dropped, so nothing messy reaches the server either
 * way — and the server normalises again regardless, since a form is not a guarantee.
 *
 * Whatever survives here is normalised to E.164 on save, so "03450186120",
 * "923450186120", "00923450186120" and "+923450186120" all end up as one number.
 */
export function PhoneInput({
  defaultValue = "",
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange"> & {
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Input
      {...props}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={value}
      onChange={(e) => setValue(sanitisePhoneInput(e.target.value))}
    />
  );
}
