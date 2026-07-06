"use client";

import { useState } from "react";
import { deleteClinic } from "@/app/admin/actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";

/**
 * Danger zone: permanently deletes the clinic and all its data (staff, patients,
 * appointments, visits, recalls). Requires typing the exact clinic name to arm
 * the button — a deliberate guard against accidental deletion.
 */
export function DeleteClinic({
  clinicId,
  clinicName,
}: {
  clinicId: string;
  clinicName: string;
}) {
  const [confirm, setConfirm] = useState("");
  const armed = confirm === clinicName;

  return (
    <form
      action={deleteClinic.bind(null, clinicId)}
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
    >
      <Input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={`Type "${clinicName}" to confirm`}
        aria-label="Confirm clinic name"
      />
      <Button type="submit" variant="destructive" disabled={!armed}>
        Delete this clinic
      </Button>
    </form>
  );
}
