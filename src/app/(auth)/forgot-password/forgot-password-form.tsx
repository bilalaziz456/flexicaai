"use client";

import { useActionState } from "react";
import { requestResetAction } from "../reset-actions";
import type { AuthActionState } from "@/core/auth/actions";
import { BackLink } from "@/core/ui/back-link";
import { Button } from "@/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(
    requestResetAction,
    {},
  );

  return (
    <Card className="p-1.5">
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your username or email and we&apos;ll send you a reset link.
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="identifier">Username or email</Label>
            <Input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          {state.message ? (
            <p className="text-sm text-success-text" role="status">
              {state.message}
            </p>
          ) : null}
          {state.error ? (
            <p className="text-sm text-destructive-text" role="alert">
              {state.error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="border-t-0 bg-transparent pt-4">
          <div className="w-full space-y-3">
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Sending…" : "Send reset link"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <BackLink href="/login">
                Back to sign in
              </BackLink>
            </p>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
