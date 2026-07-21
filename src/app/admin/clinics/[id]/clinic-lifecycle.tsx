"use client";

import { useState, useTransition } from "react";
import { setClinicStatus, extendTrial } from "../../actions";
import { ClinicStatusBadge } from "../status-badge";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/**
 * Super-admin clinic lifecycle controls (Feature 2): status badge + Suspend /
 * Resume / Cancel / Reactivate + Extend-trial. Calls the server actions in a
 * transition and surfaces any error. super-admin-gated server-side.
 */
export function ClinicLifecycle({
  clinicId,
  status,
  trialEndsAt,
}: {
  clinicId: string;
  status: string;
  trialEndsAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showSuspend, setShowSuspend] = useState(false);

  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res?.error) setError(res.error);
      else setShowSuspend(false);
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
        {/* Suspend a usable clinic (with an optional reason). */}
        {usable && status !== "trial" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setShowSuspend((s) => !s)}
          >
            Suspend
          </Button>
        ) : null}

        {/* Bring a suspended / past-due clinic back. */}
        {(status === "suspended" || status === "past_due") ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setClinicStatus(clinicId, "active"))}
          >
            Resume (activate)
          </Button>
        ) : null}

        {/* Trial: extend, or promote to a paid active plan. */}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setShowSuspend((s) => !s)}
            >
              Suspend
            </Button>
          </>
        ) : null}

        {/* Reactivate a cancelled clinic. */}
        {status === "cancelled" ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setClinicStatus(clinicId, "active"))}
          >
            Reactivate
          </Button>
        ) : null}

        {/* Cancel — available unless already cancelled. */}
        {status !== "cancelled" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              if (confirm("Cancel this clinic's subscription? Staff will be locked out.")) {
                run(() => setClinicStatus(clinicId, "cancelled"));
              }
            }}
          >
            Cancel subscription
          </Button>
        ) : null}
      </div>

      {showSuspend ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
          <Input
            placeholder="Reason (optional, shown to the clinic)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="max-w-xs"
          />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setClinicStatus(clinicId, "suspended", reason))}
          >
            {pending ? "Suspending…" : "Confirm suspend"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowSuspend(false)}>
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
