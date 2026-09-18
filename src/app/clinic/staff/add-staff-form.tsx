"use client";

import { useActionState, useEffect, useState } from "react";
import { createStaff, type ClinicActionState } from "@/app/clinic/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { SelectField } from "@/core/ui/select-field";
import { PasswordInput } from "@/core/ui/password-input";
import { Toast } from "@/core/ui/toast";
import { DoctorScheduleFields } from "@/app/clinic/doctor-schedule-fields";
import {
  defaultPermissionsForRole,
  type PermResource,
} from "@/core/auth/permissions";
import { STAFF_PREFIXES, type UserRole } from "@/core/types/auth";
import { PermissionMatrix } from "@/core/ui/permission-matrix";
import { useVocabularyLabel } from "@/core/ui/vocabulary-provider";

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
  // The role's label comes from the database (ADR-027), not a compiled map.
  const roleLabel = useVocabularyLabel("user_roles", role);
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
            <SelectField
              name="prefix"
              ariaLabel="Title"
              defaultValue=""
              required
              options={[
                { value: "", label: "Title", disabled: true },
                ...STAFF_PREFIXES.map((p) => ({ value: p, label: p })),
              ]}
              className="w-24 shrink-0"
            />
            <Input id="fullName" name="fullName" required className="flex-1" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          {/* `clinic_admin` is a second (or third) admin — a peer of whoever is adding
              them, with the same access, including staff and settings. The clinic can
              never be left with none: the last active admin cannot be suspended or
              deleted. */}
          <SelectField
            id="role"
            name="role"
            value={role}
            onValueChange={(next: UserRole) => {
              setRole(next);
              setGranted(new Set(defaultPermissionsForRole(next)));
            }}
            options={[
              { value: "doctor", label: "Doctor" },
              { value: "receptionist", label: "Receptionist" },
              { value: "manager", label: "Manager" },
              { value: "clinic_admin", label: "Clinic admin" },
            ]}
            ariaLabel="Role"
            className="w-full"
          />
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
          {/* The database's label, not the raw code — that would read
              "clinic_admin defaults" on screen. */}
          Starts from the {roleLabel.toLowerCase()} defaults. Tick View /
          Create / Edit / Delete to adjust. View is required for the others.
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
