"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  resetStaffPermissions,
  updateStaffPermissions,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";
import type { PermResource } from "@/core/auth/permissions";
import { PermissionMatrix } from "@/core/ui/permission-matrix";

/**
 * Edit an existing staff member's permissions — wraps the shared matrix in a form
 * with the save action, a "reset to role defaults" shortcut (which clears the
 * override server-side and re-syncs the grid), and toasts.
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
  const [resetting, startReset] = useTransition();

  // One success toast, re-triggered for both save and reset via a bumping nonce.
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [successNonce, setSuccessNonce] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.saved) {
      setSuccessMsg("Permissions saved.");
      setSuccessNonce((n) => n + 1);
    }
    if (state.error) {
      setErrorMsg(state.error);
      setErrorNonce((n) => n + 1);
    }
  }, [state]);

  const onReset = () =>
    startReset(async () => {
      const res = await resetStaffPermissions(userId);
      if (res.saved) {
        // Follow the role defaults now that the override is cleared.
        setGranted(new Set(roleDefaults));
        setSuccessMsg("Reset to role defaults.");
        setSuccessNonce((n) => n + 1);
      } else if (res.error) {
        setErrorMsg(res.error);
        setErrorNonce((n) => n + 1);
      }
    });

  return (
    <form action={formAction} className="space-y-4">
      <PermissionMatrix resources={resources} granted={granted} onChange={setGranted} />

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending || resetting}>
          {pending ? "Saving…" : "Save permissions"}
        </Button>
        <button
          type="button"
          onClick={onReset}
          disabled={resetting || pending}
          className="text-sm text-muted-foreground underline underline-offset-4 disabled:opacity-50"
        >
          {resetting ? "Resetting…" : "Reset to role defaults"}
        </button>
      </div>

      <Toast message={successMsg} variant="success" token={successNonce} />
      <Toast message={errorMsg} variant="error" token={errorNonce} />
    </form>
  );
}
