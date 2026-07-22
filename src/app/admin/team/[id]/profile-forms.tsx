"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteSuperAdminAction,
  editTeamMemberProfileAction,
  resetTeamMemberPasswordAction,
  setSuperAdminActiveAction,
  type TeamActionState,
} from "../actions";
import { Button } from "@/core/ui/button";
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

export function DangerActions({ userId, isActive }: { userId: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = (fn: () => Promise<{ error?: string }>, goList = false) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res?.error) setError(res.error);
      else if (goList) router.push("/admin/team");
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => run(() => setSuperAdminActiveAction(userId, !isActive))}
      >
        {isActive ? "Suspend account" : "Reactivate account"}
      </Button>
      <Button
        type="button"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (confirm("Delete this team member? Their access is removed immediately.")) {
            run(() => deleteSuperAdminAction(userId), true);
          }
        }}
      >
        Delete account
      </Button>
      {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
    </div>
  );
}
