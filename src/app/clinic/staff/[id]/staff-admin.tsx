"use client";

import { useActionState, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteStaff,
  resetStaffPassword,
  updateStaffProfile,
  type ClinicActionState,
} from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { Toast } from "@/core/ui/toast";
import { DoctorScheduleFields } from "@/app/clinic/doctor-schedule-fields";
import type { DayAvailability } from "@/core/lib/availability";
import { STAFF_PREFIXES } from "@/core/types/auth";

/**
 * Edit a staff member in ONE save — name + username, plus (for doctors) the
 * working-hours schedule, daily cap and fee. Mirrors the create form; the other
 * staff controls (password, suspend, delete, leave) stay as separate actions.
 */
export function EditStaffForm({
  userId,
  prefix,
  fullName,
  username,
  role,
  availability,
  dailyLimit,
  fee,
  flexibleHours,
}: {
  userId: string;
  prefix: string | null;
  fullName: string | null;
  username: string;
  role: string;
  availability: DayAvailability[];
  dailyLimit: number;
  fee: number;
  flexibleHours: boolean;
}) {
  const action = updateStaffProfile.bind(null, userId);
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(action, {});
  // Success redirects to the staff list (with a flash toast); a failed save
  // pops an error toast here, re-triggered per attempt.
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);
  const isDoctor = role === "doctor";
  const [scheduleValid, setScheduleValid] = useState(true);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <div className="flex gap-2">
            <select
              key={`prefix-${prefix ?? ""}`}
              name="prefix"
              aria-label="Title"
              defaultValue={prefix ?? ""}
              className="h-8 w-24 shrink-0 rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron"
            >
              <option value="">Title</option>
              {STAFF_PREFIXES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Input
              key={`name-${fullName ?? ""}`}
              id="fullName"
              name="fullName"
              defaultValue={fullName ?? ""}
              className="flex-1"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            key={`user-${username}`}
            id="username"
            name="username"
            defaultValue={username}
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
      </div>

      {isDoctor ? (
        <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Schedule &amp; fees</p>
          <DoctorScheduleFields
            defaultAvailability={availability}
            defaultLimit={dailyLimit}
            defaultFee={fee}
            defaultFlexible={flexibleHours}
            onValidChange={setScheduleValid}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || (isDoctor && !scheduleValid)}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}

/** Reset the staff member's password to a new temporary one. */
export function ResetPasswordForm({ userId }: { userId: string }) {
  const action = resetStaffPassword.bind(null, userId);
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="new-temp-password" className="text-xs">
            New temporary password
          </Label>
          <Input
            id="new-temp-password"
            name="password"
            type="text"
            placeholder="At least 8 characters"
            className="w-64"
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Setting…" : "Reset password"}
        </Button>
      </div>
      {state.saved ? (
        <p className="text-sm text-emerald-600" role="status">
          Temporary password set. They must change it at next login.
        </p>
      ) : null}
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Delete the staff member (step-up password), then return to the list. */
export function DeleteStaffButton({
  userId,
  label,
}: {
  userId: string;
  label: string;
}) {
  return (
    <ConfirmDeleteDialog
      triggerLabel="Delete staff member"
      triggerVariant="destructive"
      triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
      title="Delete staff member"
      description={`Permanently delete ${label}. Their sessions end immediately; visit history is kept.`}
      onConfirm={(password) => deleteStaff(userId, password)}
    />
  );
}
