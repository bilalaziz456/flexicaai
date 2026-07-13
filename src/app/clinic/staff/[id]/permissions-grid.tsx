"use client";

import { useActionState, useEffect, useState } from "react";
import {
  updateStaffPermissions,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";
import type { PermResource } from "@/core/auth/permissions";
import { PermissionMatrix } from "./permission-matrix";

/**
 * Edit an existing staff member's permissions — wraps the shared matrix in a form
 * with the save action, a "reset to role defaults" shortcut, and toasts.
 */
export function PermissionsGrid({
  userId,
  resources,
  initial,
  roleDefaults,
}: {
  userId: string;
  resources: PermResource[];
  /** Effective slugs to prefill (the user's overrides, or the role defaults). */
  initial: string[];
  /** The role's default slugs (for the "reset" action). */
  roleDefaults: string[];
}) {
  const [granted, setGranted] = useState<Set<string>>(() => new Set(initial));
  const action = updateStaffPermissions.bind(null, userId);
  const [state, formAction, pending] = useActionState<ClinicActionState, FormData>(
    action,
    {},
  );

  const [savedNonce, setSavedNonce] = useState(0);
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.saved) setSavedNonce((n) => n + 1);
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <PermissionMatrix resources={resources} granted={granted} onChange={setGranted} />

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save permissions"}
        </Button>
        <button
          type="button"
          onClick={() => setGranted(new Set(roleDefaults))}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Reset to role defaults
        </button>
      </div>

      <Toast
        message={state.saved ? "Permissions saved." : null}
        variant="success"
        token={savedNonce}
      />
      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
