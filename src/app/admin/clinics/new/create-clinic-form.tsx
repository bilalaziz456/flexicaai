"use client";

import Link from "next/link";
import { useActionState, useCallback, useState } from "react";
import type { SpecialtyCatalogEntry } from "@/core/types/module";
import type { TeamMemberOption } from "@/core/admin/assignment";
import {
  createClinicWithAdmin,
  type AdminActionState,
} from "@/app/admin/actions";
import { SpecialtyCheckboxes } from "@/app/admin/clinics/specialty-checkboxes";
import { Button, buttonVariants } from "@/core/ui/button";
import { cn } from "@/core/lib/utils";
import { useActionToast } from "@/core/ui/toast";
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
import { PublicContactFields } from "@/core/ui/public-contact-fields";

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
  const [logoName, setLogoName] = useState("");
  // Success redirects to the new clinic's own page (flash toast there); a failed
  // create pops an error toast here, re-triggered per attempt.
  const [hoursInvalid, setHoursInvalid] = useState(false);
  // Stable identity: the child reports validity from an effect.
  const onInvalidChange = useCallback((v: boolean) => setHoursInvalid(v), []);
  useActionToast(state, { error: true });

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
            {/* The LABEL is the control — a file input's own button cannot be made to
                match a real one's height or hover. Same move as the avatar, clinic
                logo and importer pickers; this was the last one left. */}
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="logo"
                className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer")}
              >
                {logoName ? "Choose another" : "Choose file"}
              </label>
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
                    setLogoError("Logo is too large. Please use an image under 1 MB.");
                    e.target.value = "";
                    setLogoName("");
                  } else {
                    setLogoError(null);
                    setLogoName(file?.name ?? "");
                  }
                }}
                className="sr-only"
              />
              {/* `sr-only` takes away the browser's own "No file chosen", and a picker
                  that says nothing after a pick looks like it did not work. */}
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                {logoName || "No file chosen"}
              </span>
            </div>
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
          <CardTitle>Patient-facing details (optional)</CardTitle>
          <CardDescription>
            What a patient is told when they ask over WhatsApp. Fill these in now if you
            have them &mdash; the clinic can change them later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PublicContactFields
            address={null}
            hours={null}
            onInvalidChange={onInvalidChange}
            addressHint="Sent to a patient who asks where the clinic is. Not the billing address — this is the one patients are given."
          />
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
        <Button type="submit" disabled={pending || hoursInvalid}>
          {pending ? "Creating…" : "Create clinic"}
        </Button>
        {/* Cancel sits beside Submit, so it is one of a PAIR of actions — as an
            underlined line of text it read as a footnote to the button rather than
            the other half of the choice. */}
        <Link href="/admin" className={cn(buttonVariants({ variant: "ghost" }))}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
