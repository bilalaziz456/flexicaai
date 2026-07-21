"use client";

import { useActionState } from "react";
import { submitResetAction } from "../reset-actions";
import type { AuthActionState } from "@/core/auth/actions";
import { Button } from "@/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { Label } from "@/core/ui/label";
import { PasswordInput } from "@/core/ui/password-input";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(
    submitResetAction,
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <PasswordInput id="password" name="password" autoComplete="new-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required />
          </div>
          {state.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="border-t-0 bg-transparent" style={{ paddingTop: "1rem" }}>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Set new password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
