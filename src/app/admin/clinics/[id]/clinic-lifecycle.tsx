"use client";

import { useState, useTransition } from "react";
import { setClinicStatus, extendTrial, setTrialEndDate, startTrial, endTrialNow, setTrialNoticeEnabledAction } from "../../actions";
import { Switch } from "@/core/ui/switch";
import { toast } from "@/core/ui/toast";
import { DatePicker } from "@/core/ui/date-picker";
import { ClinicStatusBadge } from "../status-badge";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { PasswordInput } from "@/core/ui/password-input";
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
  canStartTrial = false,
  defaultTrialEnd,
  minTrialEnd,
  trialNoticeEnabled = true,
  canToggleTrialNotice = false,
}: {
  clinicId: string;
  status: string;
  trialEndsAt: string | null;
  /** Owner / full super-admin — may pause (suspend/cancel) and resume access. */
  canPause?: boolean;
  /** An active clinic never billed (no payment, no invoice) — may be put on a trial. */
  canStartTrial?: boolean;
  /** yyyy-mm-dd the date pickers open on: the current end, else 30 days from today. */
  defaultTrialEnd: string;
  /** The earliest end a picker offers (tomorrow): a trial ending today is "End trial now". */
  minTrialEnd: string;
  /** Whether the clinic's staff see the "Free trial · ends …" pill (0153). */
  trialNoticeEnabled?: boolean;
  /** Owner / full admin, or this clinic's account manager. */
  canToggleTrialNotice?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [showSuspend, setShowSuspend] = useState(false);
  const [endsOn, setEndsOn] = useState(defaultTrialEnd);
  const [showStartTrial, setShowStartTrial] = useState(false);
  const [noticeOn, setNoticeOn] = useState(trialNoticeEnabled);
  const [togglingNotice, startNotice] = useTransition();
  const toggleNotice = (next: boolean) => {
    setNoticeOn(next);
    startNotice(async () => {
      const r = await setTrialNoticeEnabledAction(clinicId, next);
      if (r.error) {
        setNoticeOn(!next);
        toast.error(r.error);
        return;
      }
      toast.success(
        next
          ? "Trial notice turned on. Clinic staff will see when the trial ends."
          : "Trial notice turned off. The trial still ends on its date.",
      );
    });
  };

  const run = (fn: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (res?.error) setError(res.error);
      else {
        setShowSuspend(false);
        setShowStartTrial(false);
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
            {/* End the trial today: that locks the clinic out, so it is pausing access —
                owner / full admin only, with a password. */}
            {canPause ? (
              <ConfirmDeleteDialog
                triggerLabel="End trial now"
                triggerVariant="ghost"
                triggerClassName="text-destructive hover:text-destructive"
                title="End this clinic's trial now?"
                description="Its staff are signed out and locked out at once. Enter your password to confirm."
                confirmLabel="End trial now"
                onConfirm={(pw) => endTrialNow(clinicId, pw)}
              />
            ) : null}
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

        {/* Put a never-billed active clinic on a free trial (any editor). */}
        {canStartTrial && status === "active" ? (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setShowStartTrial((s) => !s)}>
            Start free trial
          </Button>
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

      {/* Trial end date: any day after today, longer or shorter (any editor). */}
      {status === "trial" ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border well p-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Trial ends on</span>
            <span className="block w-56"><DatePicker ariaLabel="Trial end date" value={endsOn} onChange={setEndsOn} min={minTrialEnd} /></span>
          </label>
          <Button type="button" size="sm" disabled={pending || !endsOn} onClick={() => run(() => setTrialEndDate(clinicId, endsOn))}>
            {pending ? "Saving…" : "Save end date"}
          </Button>
          <p className="basis-full text-[11px] text-muted-foreground">
            Access ends at the end of that day. Recalls that fell due while a trial was over are not sent when it comes back.
          </p>
        </div>
      ) : null}

      {status === "trial" && canToggleTrialNotice ? (
        <div className="flex items-start justify-between gap-3 rounded-md border well p-3">
          <div>
            <div className="text-sm font-medium">Show trial notice to clinic staff</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              When on, every user in this clinic sees &ldquo;Free trial: ends &hellip;&rdquo; at the bottom of
              the screen, with the account manager&rsquo;s contact in the last 7 days. Turning it off
              only hides the notice: the trial still ends on its date.
            </p>
          </div>
          <Switch
            checked={noticeOn}
            onCheckedChange={toggleNotice}
            disabled={togglingNotice}
            aria-label="Show trial notice to clinic staff"
            className="mt-0.5"
          />
        </div>
      ) : null}

      {showStartTrial ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border well p-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Trial ends on</span>
            <span className="block w-56"><DatePicker ariaLabel="Trial end date" value={endsOn} onChange={setEndsOn} min={minTrialEnd} /></span>
          </label>
          <Button type="button" size="sm" disabled={pending || !endsOn} onClick={() => run(() => startTrial(clinicId, endsOn))}>
            {pending ? "Starting…" : "Start trial"}
          </Button>
          <p className="basis-full text-[11px] text-muted-foreground">
            The clinic is not billed during the trial. &ldquo;Activate (paid)&rdquo; starts billing from that day.
          </p>
        </div>
      ) : null}

      {/* Pause (suspend) step-up: reason (optional) + the admin's own password. */}
      {showSuspend ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border well p-3">
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
            <PasswordInput
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
