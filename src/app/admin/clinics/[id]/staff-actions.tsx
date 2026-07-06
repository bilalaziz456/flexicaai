"use client";

import { useActionState, useState } from "react";
import {
  resetUserPassword,
  setUserActive,
  type AdminActionState,
} from "@/app/admin/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/**
 * Per-staff management: suspend/reactivate and reset password (issues a new
 * temporary password + forces a change on next login). Super admins never
 * appear in a clinic's staff list, so there's no self-lockout here.
 */
export function StaffActions({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const resetAction = resetUserPassword.bind(null, userId);
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(resetAction, {});

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <form action={setUserActive.bind(null, userId, !isActive)}>
          <Button type="submit" variant="outline" size="sm">
            {isActive ? "Suspend" : "Reactivate"}
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setResetOpen((o) => !o)}
        >
          Reset password
        </Button>
      </div>

      {resetOpen ? (
        <form action={formAction} className="flex items-center justify-end gap-2">
          <Input
            name="password"
            type="text"
            placeholder="New temporary password"
            className="h-8 w-56"
            required
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Setting…" : "Set"}
          </Button>
        </form>
      ) : null}

      {state.error ? (
        <p className="text-right text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p className="text-right text-xs text-emerald-600" role="status">
          Temporary password set. They must change it at next login.
        </p>
      ) : null}
    </div>
  );
}
