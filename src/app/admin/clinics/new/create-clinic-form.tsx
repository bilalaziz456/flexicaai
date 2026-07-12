"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import type { SpecialtyCatalogEntry } from "@/core/types/module";
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

export function CreateClinicForm({
  catalog,
}: {
  catalog: SpecialtyCatalogEntry[];
}) {
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(createClinicWithAdmin, {});
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
