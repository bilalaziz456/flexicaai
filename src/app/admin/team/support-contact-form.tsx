"use client";

import { useActionState } from "react";
import { setCompanySupportContactAction, type TeamActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { PhoneInput } from "@/core/ui/phone-input";
import { useActionToast } from "@/core/ui/toast";

/**
 * The company's own contact details — the fallback a clinic sees when it has no
 * account manager, or its manager has no number.
 *
 * Both fields are optional on purpose. Filling in only a number, or only an email, is
 * a legitimate state, and demanding both would stop the owner recording the one they
 * actually have.
 */
export function SupportContactForm({
  phone,
  email,
}: {
  phone: string | null;
  email: string | null;
}) {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(
    setCompanySupportContactAction,
    {},
  );
  useActionToast(state, { saved: "Company contact saved." });

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="supportPhone">Phone</Label>
          <PhoneInput id="supportPhone" name="supportPhone" defaultValue={phone ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="supportEmail">Email</Label>
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={email ?? ""}
          />
        </div>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save contact"}
      </Button>
    </form>
  );
}
