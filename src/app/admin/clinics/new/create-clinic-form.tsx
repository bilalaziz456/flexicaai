"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { SpecialtyCatalogEntry } from "@/core/types/module";
import type { TeamMemberOption } from "@/core/admin/assignment";
import {
  createClinicWithAdmin,
  type AdminActionState,
} from "@/app/admin/actions";
import { SpecialtyCheckboxes } from "@/app/admin/clinics/specialty-checkboxes";
import { Button } from "@/core/ui/button";
import { Toast } from "@/core/ui/toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/core/ui/card";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { PasswordInput } from "@/core/ui/password-input";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { MAX_LOGO_BYTES } from "@/core/clinics/logo-limits";

export function CreateClinicForm({
  catalog,
  team,
}: {
  catalog: SpecialtyCatalogEntry[];
  team: TeamMemberOption[];
}) {
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(createClinicWithAdmin, {});
  const [assignee, setAssignee] = useState("");
  const [logoError, setLogoError] = useState<string | null>(null);
  // Success redirects to the clinics list (flash toast); a failed create pops an
  // error toast here, re-triggered per attempt.
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

  return (
    <form action={formAction} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Clinic</CardTitle>
          <CardDescription>Name and the specialties it offers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clinicName">Clinic name</Label>
            <Input id="clinicName" name="clinicName" required />
          </div>
          <div className="space-y-2">
            <Label>Specialties</Label>
            <SpecialtyCheckboxes catalog={catalog} />
          </div>
          <div className="space-y-2">
            <Label>Account manager (optional)</Label>
            <SearchableSelect
              ariaLabel="Account manager"
              name="assignedTo"
              value={assignee}
              onChange={setAssignee}
              options={[
                { value: "", label: "Unassigned" },
                ...team.map((m) => ({ value: m.id, label: m.name })),
              ]}
              placeholder="Unassigned"
              className="w-full max-w-sm"
            />
            <p className="text-xs text-muted-foreground">
              The team member who owns this clinic on our side. Can be changed later.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo">Logo (optional)</Label>
            <input
              id="logo"
              type="file"
              name="logo"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Block an oversized logo before submit (else the whole create request
                // trips Next's 1 MB body limit and crashes).
                if (file && file.size > MAX_LOGO_BYTES) {
                  setLogoError("Logo is too large — please use an image under 1 MB.");
                  e.target.value = "";
                } else {
                  setLogoError(null);
                }
              }}
              className="block text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-[var(--input-bg)] file:px-3 file:py-1.5 file:text-sm hover:file:bg-accent"
            />
            {logoError ? (
              <p className="text-xs text-destructive">{logoError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Printed at the top of invoices &amp; receipts (a B&amp;W/thermal printer renders it in
                black &amp; white). Under 1 MB. Can be added or changed later.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clinic Admin</CardTitle>
          <CardDescription>
            The clinic owner&apos;s login. They add their own staff later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="adminFullName">Full name</Label>
            <Input id="adminFullName" name="adminFullName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adminUsername">Username</Label>
            <Input
              id="adminUsername"
              name="adminUsername"
              type="text"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. citydental"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adminPassword">Temporary password</Label>
            <PasswordInput
              id="adminPassword"
              name="adminPassword"
              autoComplete="new-password"
              required
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create clinic"}
        </Button>
        <Link
          href="/admin"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Cancel
        </Link>
      </div>

      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
