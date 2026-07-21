"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signIn, type AuthActionState } from "@/core/auth/actions";
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
import { PasswordInput } from "@/core/ui/password-input";

export function LoginForm({
  initialError,
  initialMessage,
}: {
  initialError?: string;
  initialMessage?: string;
}) {
  const [state, formAction, pending] = useActionState<
    AuthActionState,
    FormData
  >(signIn, { error: initialError, message: initialMessage });

  // Username/password are controlled so their values survive the two-phase 2FA
  // submit (React 19 resets uncontrolled fields after a form action).
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const twoFactor = state.totpRequired === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{twoFactor ? "Two-factor authentication" : "Sign in"}</CardTitle>
        <CardDescription>
          {twoFactor
            ? "Enter the 6-digit code from your authenticator app."
            : "Access your Klenic workspace."}
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          {/* Phase 1 fields. In the 2FA phase they stay in the form (hidden) so
              username+password are re-posted and re-verified with the code. */}
          <div className={twoFactor ? "hidden" : "space-y-2"}>
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required={!twoFactor}
            />
          </div>
          <div className={twoFactor ? "hidden" : "space-y-2"}>
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!twoFactor}
            />
          </div>

          {twoFactor ? (
            <div className="space-y-2">
              <Label htmlFor="totp">Authentication code</Label>
              <Input
                id="totp"
                name="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                Lost your device? Enter one of your backup codes instead.
              </p>
            </div>
          ) : null}

          {state.message ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
              {state.message}
            </p>
          ) : null}
          {state.error ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col gap-2 border-t-0 bg-transparent" style={{ paddingTop: "1rem" }}>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : twoFactor ? "Verify" : "Sign in"}
          </Button>
          {twoFactor ? (
            <Link
              href="/login"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Start over
            </Link>
          ) : null}
        </CardFooter>
      </form>
    </Card>
  );
}
