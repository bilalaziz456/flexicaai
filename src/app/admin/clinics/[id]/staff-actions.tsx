"use client";

import { useActionState, useState } from "react";
import {
  resetUserPassword,
  setUserActive,
  updateStaffProfile,
  type AdminActionState,
} from "@/app/admin/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

/**
 * Per-staff management: edit name/username, suspend/reactivate, reset password
 * (issues a new temporary password + forces a change on next login). Super
 * admins never appear in a clinic's staff list, so there's no self-lockout here.
 */
export function StaffActions({
  userId,
  username,
  fullName,
  isActive,
}: {
  userId: string;
  username: string;
  fullName: string | null;
  isActive: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  const editAction = updateStaffProfile.bind(null, userId);
  const [editState, editFormAction, editing] = useActionState<
    AdminActionState,
    FormData
  >(editAction, {});

  const resetAction = resetUserPassword.bind(null, userId);
  const [resetState, resetFormAction, resetting] = useActionState<
    AdminActionState,
    FormData
  >(resetAction, {});

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditOpen((o) => !o)}
        >
          Edit
        </Button>
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

      {editOpen ? (
        <form
          action={editFormAction}
          className="flex flex-col items-end gap-2 rounded-md border p-3 sm:flex-row sm:items-end"
        >
          <div className="w-full space-y-1 sm:w-auto">
            <Label htmlFor={`name-${userId}`} className="text-xs">
              Full name
            </Label>
            <Input
              id={`name-${userId}`}
              name="fullName"
              defaultValue={fullName ?? ""}
              className="h-8"
              required
            />
          </div>
          <div className="w-full space-y-1 sm:w-auto">
            <Label htmlFor={`user-${userId}`} className="text-xs">
              Username
            </Label>
            <Input
              id={`user-${userId}`}
              name="username"
              defaultValue={username}
              autoCapitalize="none"
              spellCheck={false}
              className="h-8"
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={editing}>
            {editing ? "Saving…" : "Save"}
          </Button>
        </form>
      ) : null}

      {resetOpen ? (
        <form
          action={resetFormAction}
          className="flex items-center justify-end gap-2"
        >
          <Input
            name="password"
            type="text"
            placeholder="New temporary password"
            className="h-8 w-56"
            required
          />
          <Button type="submit" size="sm" disabled={resetting}>
            {resetting ? "Setting…" : "Set"}
          </Button>
        </form>
      ) : null}

      {editState.error ? (
        <p className="text-right text-xs text-destructive" role="alert">
          {editState.error}
        </p>
      ) : null}
      {editState.saved ? (
        <p className="text-right text-xs text-emerald-600" role="status">
          Saved.
        </p>
      ) : null}
      {resetState.error ? (
        <p className="text-right text-xs text-destructive" role="alert">
          {resetState.error}
        </p>
      ) : null}
      {resetState.saved ? (
        <p className="text-right text-xs text-emerald-600" role="status">
          Temporary password set. They must change it at next login.
        </p>
      ) : null}
    </div>
  );
}
