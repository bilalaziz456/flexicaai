"use client";

import { useActionState, useState } from "react";
import { Ban, KeyRound, Pencil, RotateCcw, Trash2 } from "lucide-react";
import {
  deleteStaff,
  resetStaffPassword,
  setStaffActive,
  updateStaffProfile,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

/**
 * Per-staff management for the clinic admin: edit name/username, suspend/
 * reactivate, and reset password. All actions are scoped to the admin's own
 * clinic and to doctor/receptionist staff.
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
    ClinicActionState,
    FormData
  >(editAction, {});

  const resetAction = resetStaffPassword.bind(null, userId);
  const [resetState, resetFormAction, resetting] = useActionState<
    ClinicActionState,
    FormData
  >(resetAction, {});

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Edit"
          onClick={() => setEditOpen((o) => !o)}
        >
          <Pencil className="size-4" aria-hidden="true" />
          <span className="hidden md:inline">Edit</span>
        </Button>
        <form action={setStaffActive.bind(null, userId, !isActive)}>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            aria-label={isActive ? "Suspend" : "Reactivate"}
          >
            {isActive ? (
              <Ban className="size-4" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            <span className="hidden md:inline">
              {isActive ? "Suspend" : "Reactivate"}
            </span>
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Reset password"
          onClick={() => setResetOpen((o) => !o)}
        >
          <KeyRound className="size-4" aria-hidden="true" />
          <span className="hidden md:inline">Reset password</span>
        </Button>
        <ConfirmDeleteDialog
          triggerLabel="Delete"
          triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
          triggerClassName="text-destructive hover:text-destructive"
          title="Delete staff member"
          description={`Permanently delete ${fullName ?? username}. Their sessions end immediately; visit history is kept.`}
          onConfirm={(password) => deleteStaff(userId, password)}
        />
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
              key={`name-${fullName ?? ""}`}
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
              key={`user-${username}`}
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
