"use client";

import { useActionState, useState, useTransition } from "react";
import {
  resetStaffPermissions,
  updateStaffPermissions,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { toast, useActionToast } from "@/core/ui/toast";
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

  useActionToast(state, { saved: "Permissions saved.", error: true });

  const onReset = () =>
    startReset(async () => {
      const res = await resetStaffPermissions(userId);
      if (res.saved) {
        // Follow the role defaults now that the override is cleared.
        setGranted(new Set(roleDefaults));
        toast.success("Reset to role defaults.");
      } else if (res.error) {
        toast.error(res.error);
      }
    });

  return (
    <form action={formAction} className="space-y-4">
      <PermissionMatrix resources={resources} granted={granted} onChange={setGranted} />

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending || resetting}>
          {pending ? "Saving…" : "Save permissions"}
        </Button>
        <Button
          type="button"
          onClick={onReset}
          disabled={resetting || pending}
          size="sm" variant="outline"
        >
          {resetting ? "Resetting…" : "Reset to role defaults"}
        </Button>
      </div>

    </form>
  );
}
