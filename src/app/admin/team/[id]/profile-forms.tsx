"use client";

import { useActionState, useState, useTransition } from "react";
import {
  deactivateMemberAction,
  deleteSuperAdminAction,
  editTeamMemberProfileAction,
  reactivateMemberAction,
  resetTeamMemberPasswordAction,
  suspendMemberAction,
  type TeamActionState,
} from "../actions";
import type { AdminAccountState } from "@/core/auth/admin-permissions";
import { Button } from "@/core/ui/button";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { ConfirmDialog } from "@/core/ui/confirm-dialog";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { PasswordInput } from "@/core/ui/password-input";
import { Toast } from "@/core/ui/toast";

export function ProfileForm({
  userId,
  fullName,
  username,
}: {
  userId: string;
  fullName: string;
  username: string;
}) {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(
    editTeamMemberProfileAction.bind(null, userId),
    {},
  );
  const [nameVal, setNameVal] = useState(fullName);
  const [userVal, setUserVal] = useState(username);
  return (
    <form action={action} className="space-y-3">
      {state.saved ? <Toast message="Profile saved." /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" value={nameVal} onChange={(e) => setNameVal(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" name="username" value={userVal} onChange={(e) => setUserVal(e.target.value)} autoCapitalize="none" spellCheck={false} required />
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
    </form>
  );
}

export function PasswordResetForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(
    resetTeamMemberPasswordAction.bind(null, userId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      {state.saved ? <Toast message="Password reset — they must set a new one on next login." /> : null}
      <div className="max-w-sm space-y-2">
        <Label htmlFor="password">New temporary password</Label>
        <PasswordInput id="password" name="password" autoComplete="new-password" required />
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Resetting…" : "Reset password"}</Button>
    </form>
  );
}

export function DangerActions({
  userId,
  state,
  canEdit,
  canDelete,
}: {
  userId: string;
  state: AdminAccountState;
  /** Holds team:edit — may suspend/deactivate/reactivate. */
  canEdit: boolean;
  /** Holds team:delete — may delete (with a password step-up). */
  canDelete: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res?.error) setError(res.error);
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Active → Suspend (keeps clinics). Suspended → Deactivate (unassigns) /
          Reactivate. Deactivated → Reactivate. (team:edit) */}
      {canEdit && state === "active" ? (
        <ConfirmDialog
          triggerLabel="Suspend"
          triggerVariant="outline"
          triggerDisabled={pending}
          title="Suspend team member"
          description="They won't be able to log in. Their clinics stay assigned to them — you can reactivate them anytime."
          confirmLabel="Suspend"
          onConfirm={() => suspendMemberAction(userId)}
        />
      ) : null}
      {canEdit && state === "suspended" ? (
        <ConfirmDialog
          triggerLabel="Deactivate (unassign clinics)"
          triggerVariant="outline"
          triggerDisabled={pending}
          title="Deactivate team member"
          description="They won't be able to log in, AND every clinic they manage will be unassigned. You can reactivate them later, but the clinic assignments won't come back automatically."
          confirmLabel="Deactivate"
          confirmVariant="destructive"
          onConfirm={() => deactivateMemberAction(userId)}
        />
      ) : null}
      {canEdit && state !== "active" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => reactivateMemberAction(userId))}>
          Reactivate
        </Button>
      ) : null}
      {/* Delete requires re-typing your own password (step-up auth). team:delete. */}
      {canDelete ? (
        <ConfirmDeleteDialog
          triggerLabel="Delete account"
          triggerVariant="destructive"
          title="Delete team member"
          description="This removes their access and unassigns any clinics they manage. The account moves to Trash."
          confirmLabel="Delete account"
          onConfirm={(password) => deleteSuperAdminAction(userId, password)}
        />
      ) : null}
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
    </div>
  );
}
