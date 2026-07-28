"use client";

import { useState, useTransition } from "react";
import { setClinicStatus, extendTrial } from "../../actions";
import { ClinicStatusBadge } from "../status-badge";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";

/**
 * Super-admin clinic lifecycle controls (Feature 2): status badge + Suspend /
 * Resume / Cancel / Reactivate + Extend-trial. PAUSING or resuming a clinic's
 * access is owner/super-admin only (`canPause`) — an account manager can't — and a
 * PAUSE (suspend / cancel) additionally requires a password step-up. Overdue clinics
 * are never auto-paused; this is the deliberate manual gate. Trial onboarding
 * (extend / activate) stays available to any editor.
 */
export function ClinicLifecycle({
  clinicId,
  status,
  trialEndsAt,
  canPause = false,
}: {
  clinicId: string;
  status: string;
  trialEndsAt: string | null;
  /** Owner / full super-admin — may pause (suspend/cancel) and resume access. */
  canPause?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [showSuspend, setShowSuspend] = useState(false);

  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res?.error) setError(res.error);
      else {
        setShowSuspend(false);
        setPassword("");
        setReason("");
      }
    });

  const usable =
    status === "active" || (status === "trial" && (!trialEndsAt || new Date(trialEndsAt) > new Date()));
  const trialEndLabel = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Status</span>
        <ClinicStatusBadge status={status} />
        {status === "trial" ? (
          <span className="text-xs text-muted-foreground">
            {trialEndLabel ? `ends ${trialEndLabel}` : "open-ended"}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Suspend a usable clinic (password step-up, owner/super-admin only). */}
        {canPause && usable && status !== "trial" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setShowSuspend((s) => !s)}
          >
            Pause access
          </Button>
        ) : null}

        {/* Bring a suspended / past-due clinic back (owner/super-admin only). */}
        {canPause && (status === "suspended" || status === "past_due") ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setClinicStatus(clinicId, "active"))}
          >
            Resume (activate)
          </Button>
        ) : null}

        {/* Trial: extend, or promote to a paid active plan (onboarding — any editor). */}
        {status === "trial" ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(() => extendTrial(clinicId, 30))}
            >
              Extend trial +30 days
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => run(() => setClinicStatus(clinicId, "active"))}
            >
              Activate (paid)
            </Button>
            {canPause ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setShowSuspend((s) => !s)}
              >
                Pause access
              </Button>
            ) : null}
          </>
        ) : null}

        {/* Reactivate a cancelled clinic (owner/super-admin only). */}
        {canPause && status === "cancelled" ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setClinicStatus(clinicId, "active"))}
          >
            Reactivate
          </Button>
        ) : null}

        {/* Cancel — password step-up; owner/super-admin only; unless already cancelled. */}
        {canPause && status !== "cancelled" ? (
          <ConfirmDeleteDialog
            triggerLabel="Cancel subscription"
            triggerVariant="ghost"
            triggerClassName="text-destructive hover:text-destructive"
            title="Cancel this clinic’s subscription?"
            description="Staff will be locked out immediately. Enter your password to confirm."
            confirmLabel="Cancel subscription"
            onConfirm={(pw) => setClinicStatus(clinicId, "cancelled", undefined, pw)}
          />
        ) : null}
      </div>

      {/* Pause (suspend) step-up: reason (optional) + the admin's own password. */}
      {showSuspend ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Reason (optional, shown to the clinic)</span>
            <Input
              placeholder="e.g. non-payment"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-56"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Your password</span>
            <Input
              type="password"
              placeholder="Confirm with your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="w-56"
            />
          </label>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending || !password}
            onClick={() => run(() => setClinicStatus(clinicId, "suspended", reason, password))}
          >
            {pending ? "Pausing…" : "Confirm pause"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setShowSuspend(false); setPassword(""); }}>
            Cancel
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
