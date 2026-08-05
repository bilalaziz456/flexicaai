"use client";

import { useActionState, useState, useTransition } from "react";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  regenerateBackupCodes,
  type ConfirmEnrollState,
  type DisableState,
  type RegenState,
} from "./actions";
import { Badge } from "@/core/ui/badge";
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

/** Split the base32 secret into 4-char groups for readable manual entry. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/** One-time list of backup codes with a copy button. */
function BackupCodes({ codes, title }: { codes: string[]; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Save these now: each works once and they won&apos;t be shown again. Use one if you
        lose access to your authenticator.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => {
          void navigator.clipboard?.writeText(codes.join("\n"));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy all"}
      </Button>
    </div>
  );
}

export function SecurityPanel({
  enabled,
  backupCount,
}: {
  enabled: boolean;
  backupCount: number;
}) {
  if (enabled) return <EnabledView backupCount={backupCount} />;
  return <EnrollView />;
}

// ---- Not enrolled: begin → confirm ---------------------------------------

function EnrollView() {
  const [enroll, setEnroll] = useState<{ secret: string; otpauth: string } | null>(null);
  const [beginError, setBeginError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [confirmState, confirmAction, confirming] = useActionState<
    ConfirmEnrollState,
    FormData
  >(confirmTotpEnrollment, {});

  if (confirmState.backupCodes) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-factor authentication is on</CardTitle>
          <CardDescription>Store your backup codes before you leave this page.</CardDescription>
        </CardHeader>
        <CardContent>
          <BackupCodes codes={confirmState.backupCodes} title="Your backup codes" />
        </CardContent>
        <CardFooter className="border-t-0">
          <Button type="button" onClick={() => window.location.reload()}>
            Done
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
        <CardDescription>
          Use any authenticator app (Google Authenticator, Authy, 1Password…).
        </CardDescription>
      </CardHeader>

      {!enroll ? (
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Two-factor authentication is currently <Badge variant="outline">off</Badge>.
          </p>
          {beginError ? (
            <p className="text-sm text-destructive" role="alert">
              {beginError}
            </p>
          ) : null}
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setBeginError(null);
                const res = await beginTotpEnrollment();
                if (res.error || !res.secret || !res.otpauth) {
                  setBeginError(res.error ?? "Could not start enrolment.");
                  return;
                }
                setEnroll({ secret: res.secret, otpauth: res.otpauth });
              })
            }
          >
            {pending ? "Preparing…" : "Enable two-factor"}
          </Button>
        </CardContent>
      ) : (
        <form action={confirmAction}>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">1. Add this key to your authenticator app</p>
              <p className="text-xs text-muted-foreground">
                Choose &ldquo;enter a setup key&rdquo; and paste the key below (type: time-based).
              </p>
              <code className="mt-1 block break-all rounded-md bg-muted px-3 py-2 font-mono text-sm tracking-wider">
                {groupSecret(enroll.secret)}
              </code>
              <a
                href={enroll.otpauth}
                className="text-xs text-primary-text underline underline-offset-2"
              >
                Open in an authenticator app
              </a>
            </div>
            <input type="hidden" name="secret" value={enroll.secret} />
            <div className="space-y-2">
              <Label htmlFor="code">2. Enter the 6-digit code it shows</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                required
              />
            </div>
            {confirmState.error ? (
              <p className="text-sm text-destructive" role="alert">
                {confirmState.error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="gap-2 border-t-0">
            <Button type="submit" disabled={confirming}>
              {confirming ? "Verifying…" : "Verify & turn on"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEnroll(null)}>
              Cancel
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}

// ---- Enrolled: regenerate codes / disable --------------------------------

function EnabledView({ backupCount }: { backupCount: number }) {
  const [regenState, regenAction, regenning] = useActionState<RegenState, FormData>(
    regenerateBackupCodes,
    {},
  );
  const [disableState, disableAction, disabling] = useActionState<DisableState, FormData>(
    disableTotp,
    {},
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Two-factor authentication <Badge>on</Badge>
          </CardTitle>
          <CardDescription>
            You have {backupCount} unused backup {backupCount === 1 ? "code" : "codes"}.
          </CardDescription>
        </CardHeader>
        {regenState.backupCodes ? (
          <CardContent>
            <BackupCodes codes={regenState.backupCodes} title="New backup codes" />
          </CardContent>
        ) : (
          <form action={regenAction}>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Regenerating replaces all existing backup codes.
              </p>
              <div className="space-y-2">
                <Label htmlFor="regen-password">Confirm your password</Label>
                <PasswordInput
                  id="regen-password"
                  name="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {regenState.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {regenState.error}
                </p>
              ) : null}
            </CardContent>
            <CardFooter className="border-t-0">
              <Button type="submit" variant="outline" disabled={regenning}>
                {regenning ? "Generating…" : "Regenerate backup codes"}
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Turn off two-factor authentication</CardTitle>
          <CardDescription>
            Your account will be protected by password only. Not recommended.
          </CardDescription>
        </CardHeader>
        <form action={disableAction}>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="disable-password">Confirm your password</Label>
              <PasswordInput
                id="disable-password"
                name="password"
                autoComplete="current-password"
                required
              />
            </div>
            {disableState.error ? (
              <p className="text-sm text-destructive" role="alert">
                {disableState.error}
              </p>
            ) : null}
            {disableState.message ? (
              <p className="text-sm text-emerald-600" role="status">
                {disableState.message}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="border-t-0">
            <Button type="submit" variant="destructive" disabled={disabling}>
              {disabling ? "Disabling…" : "Disable two-factor"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
