"use client";

import { useActionState, useEffect, useRef } from "react";
import { createSuperAdminAction, type TeamActionState } from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { PasswordInput } from "@/core/ui/password-input";
import { Toast } from "@/core/ui/toast";
import { cn } from "@/core/lib/utils";

const selectClass = cn(
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
);

export function CreateSuperAdminForm() {
  const [state, action, pending] = useActionState<TeamActionState, FormData>(
    createSuperAdminAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      {state.saved ? <Toast message="Team member added." /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input id="username" name="username" autoCapitalize="none" spellCheck={false} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Temporary password</Label>
          <PasswordInput id="password" name="password" autoComplete="new-password" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="subRole">Sub-role</Label>
          <select id="subRole" name="subRole" defaultValue="support" className={selectClass}>
            <option value="super_admin">Super admin — full access</option>
            <option value="support">Support — clinics, impersonate, announcements</option>
            <option value="sales">Sales — add & manage clinics</option>
            <option value="billing">Billing — record payments</option>
          </select>
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add team member"}</Button>
    </form>
  );
}
