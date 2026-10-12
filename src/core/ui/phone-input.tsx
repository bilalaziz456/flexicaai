"use client";

import { useState } from "react";
import { Input } from "@/core/ui/input";
import { PHONE_ERROR, PHONE_PATTERN, PHONE_PLACEHOLDER, sanitisePhoneInput } from "@/core/lib/phone";

/**
 * A phone field that can only ever hold a phone number.
 *
 * It sanitises as you type rather than rejecting on submit: pasting
 * "+92 345-018 6120" out of a chat is a perfectly good number, and refusing it
 * teaches people the form is fussy without making the stored data any cleaner. The
 * spaces and dashes are simply dropped, so nothing messy reaches the server either
 * way — and the server normalises again regardless, since a form is not a guarantee.
 *
 * Whatever survives here is normalised to E.164 on save, so "03450186111",
 * "923450186111", "00923450186111" and "+923450186111" all end up as one number.
 *
 * The ONE placeholder and the ONE message for every phone / WhatsApp field (owner's
 * call, 2026-10-13): the browser checks the format before the form is sent
 * (`PHONE_PATTERN`) and says it in plain words (`PHONE_ERROR`) instead of its
 * generic "match the requested format"; the server re-checks with `isValidMobile`.
 */
export function PhoneInput({
  defaultValue = "",
  placeholder = PHONE_PLACEHOLDER,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type" | "value" | "onChange" | "pattern"> & {
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Input
      {...props}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={placeholder}
      pattern={PHONE_PATTERN}
      title={PHONE_ERROR}
      maxLength={16}
      value={value}
      onChange={(e) => {
        // Clear an earlier "invalid" message as soon as the person edits the number.
        e.currentTarget.setCustomValidity("");
        setValue(sanitisePhoneInput(e.target.value));
      }}
      onInvalid={(e) => {
        const el = e.currentTarget;
        el.setCustomValidity(el.validity.valueMissing ? "Enter a mobile number, e.g. 03450186111." : PHONE_ERROR);
      }}
    />
  );
}
