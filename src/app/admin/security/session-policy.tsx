"use client";

import { useActionState } from "react";
import { saveSessionIdle } from "./actions";
import { Button } from "@/core/ui/button";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
import { useActionToast } from "@/core/ui/toast";
import { SESSION_IDLE_OPTIONS, idleLabel } from "@/core/auth/session-idle";
import { useState } from "react";

/**
 * The idle-session timeout, company-wide.
 *
 * The options come from a PURE module both sides import (conventions §3) — this is a
 * client component, so reaching for `core/admin/company-settings` would drag the pg
 * pool toward the browser bundle. `idleLabel` lives there too, so the dropdown and the
 * audit line cannot describe the same setting in different words.
 */
export function SessionPolicy({ current }: { current: number }) {
  const [state, formAction, pending] = useActionState<{ error?: string; saved?: boolean }, FormData>(
    saveSessionIdle,
    {},
  );
  const [minutes, setMinutes] = useState(String(current));
  useActionToast(state, { saved: "Session timeout saved.", error: true });

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="minutes">Sign out after inactivity</Label>
        <SelectField
          value={minutes}
          onValueChange={setMinutes}
          options={SESSION_IDLE_OPTIONS.map((m) => ({ value: String(m), label: idleLabel(m) }))}
          ariaLabel="Idle session timeout"
          className="w-56"
        />
        <input type="hidden" name="minutes" value={minutes} />
        <p className="text-xs text-muted-foreground">
          {/* Both halves are worth stating: what it does, and what it does NOT replace.
              Somebody reading "Never" could reasonably assume sessions are permanent. */}
          Applies to everyone, including super admins. Sessions always expire after 7
          days regardless of this setting.
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
