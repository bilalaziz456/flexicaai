"use client";

import { useActionState, useEffect, useState } from "react";
import { createStaff, type ClinicActionState } from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { PasswordInput } from "@/core/ui/password-input";
import { Toast } from "@/core/ui/toast";
import { DoctorScheduleFields } from "@/app/clinic/doctor-schedule-fields";
import {
  defaultPermissionsForRole,
  type PermResource,
} from "@/core/auth/permissions";
import { STAFF_PREFIXES, type UserRole } from "@/core/types/auth";
import { PermissionMatrix } from "./[id]/permission-matrix";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron";

export function AddStaffForm({ resources }: { resources: PermResource[] }) {
  const [state, formAction, pending] = useActionState<
    ClinicActionState,
    FormData
  >(createStaff, {});
  const [role, setRole] = useState<UserRole>("doctor");
  const [scheduleValid, setScheduleValid] = useState(true);
  // Permissions start from the selected role's defaults and reset when the role
  // changes; the admin can tweak them before creating the account.
  const [granted, setGranted] = useState<Set<string>>(
    () => new Set(defaultPermissionsForRole("doctor")),
  );
  // Re-pop the error toast on each failed submit (success redirects away).
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <div className="flex gap-2">
            <select
              name="prefix"
              aria-label="Title"
              defaultValue=""
              className={`${selectCls} w-24 shrink-0`}
            >
              <option value="">Title</option>
              {STAFF_PREFIXES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Input id="fullName" name="fullName" required className="flex-1" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            name="role"
            value={role}
            onChange={(e) => {
              const next = e.target.value as UserRole;
              setRole(next);
              setGranted(new Set(defaultPermissionsForRole(next)));
            }}
            className="h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron"
          >
            <option value="doctor">Doctor</option>
            <option value="receptionist">Receptionist</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            name="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Temporary password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            required
          />
        </div>
      </div>

      {/* Doctors get a working-hours schedule + daily appointment cap. */}
      {role === "doctor" ? (
        <DoctorScheduleFields onValidChange={setScheduleValid} />
      ) : null}

      {/* Permissions — prefilled from the role's defaults, adjustable now. */}
      <div className="space-y-2">
        <Label>Permissions</Label>
        <p className="text-xs text-muted-foreground">
          Starts from the {role} defaults — tick View / Create / Edit / Delete to
          adjust. View is required for the others.
        </p>
        <PermissionMatrix resources={resources} granted={granted} onChange={setGranted} />
      </div>

      <Button
        type="submit"
        disabled={pending || (role === "doctor" && !scheduleValid)}
      >
        {pending ? "Adding…" : "Add staff"}
      </Button>

      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
