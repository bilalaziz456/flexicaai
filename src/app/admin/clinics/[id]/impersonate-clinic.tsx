"use client";

import { useState, useTransition } from "react";
import { startImpersonation } from "../../actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { PasswordInput } from "@/core/ui/password-input";

/**
 * Super-admin "view as clinic" (Feature 5): step-up (password + TOTP when enrolled)
 * then start a READ-ONLY impersonation session. The action redirects into the
 * clinic workspace on success. super-admin-gated server-side.
 */
export function ImpersonateClinic({ clinicId }: { clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      // Resolves only on error — success redirects into /clinic.
      const res = await startImpersonation(clinicId, password, totp);
      if (res?.needsTotp) setNeedsTotp(true);
      if (res?.error) setError(res.error);
    });

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Open workspace (view as clinic)
      </Button>
    );
  }

  return (
    <div className="max-w-sm space-y-3 rounded-md border p-4">
      <p className="text-sm text-muted-foreground">
        You&apos;ll enter this clinic&apos;s workspace <span className="font-medium">read-only</span>.
        Confirm your identity to continue.
      </p>
      <div className="space-y-2">
        <Label htmlFor="imp-password">Your password</Label>
        <PasswordInput
          id="imp-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {needsTotp ? (
        <div className="space-y-2">
          <Label htmlFor="imp-totp">Authenticator code</Label>
          <Input
            id="imp-totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            autoFocus
          />
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" onClick={submit} disabled={pending || !password}>
          {pending ? "Opening…" : "Enter workspace"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
            setPassword("");
            setTotp("");
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
