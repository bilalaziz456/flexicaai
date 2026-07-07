"use client";

import { useActionState, useState } from "react";
import {
  resetStaffPassword,
  setStaffActive,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/** Per-staff management for the clinic admin: suspend/reactivate + reset password. */
export function StaffActions({
  userId,
  isActive,
}: {
  userId: string;
  isActive: boolean;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  const resetAction = resetStaffPassword.bind(null, userId);
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(resetAction, {});

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <form action={setStaffActive.bind(null, userId, !isActive)}>
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
