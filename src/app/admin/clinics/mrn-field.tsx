"use client";

import { useState } from "react";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import {
  DEFAULT_STARTING_MRN,
  MRN_MAX_LENGTH,
  MRN_MIN_DIGITS,
  MRN_MIN_LENGTH,
  parseStartingMrn,
} from "@/core/patients/mrn-series";

/**
 * The clinic's MRN series, set by the super admin / account manager — "FA-100001",
 * "GS-00000001". Letters, numbers and - only (capitals), ending in at least
 * MRN_MIN_DIGITS digits; the same `parseStartingMrn` the server runs explains what is
 * wrong as you type. On the clinic page it shows the NEXT MRN, so changing it starts a
 * new series for new patients only — nobody already registered is relabelled.
 */
export function MrnField({
  defaultValue = "",
  mode,
}: {
  defaultValue?: string;
  /** "create" = the starting MRN (empty → FA-100001); "edit" = the next MRN. */
  mode: "create" | "edit";
}) {
  const [value, setValue] = useState(defaultValue);
  const problem = value.trim() && value !== defaultValue ? parseStartingMrn(value) : null;
  const error = problem && "error" in problem ? problem.error : null;
  return (
    <div className="space-y-2">
      <Label htmlFor="startingMrn">{mode === "create" ? "Starting MRN (optional)" : "Next MRN"}</Label>
      <Input
        id="startingMrn"
        name="startingMrn"
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, MRN_MAX_LENGTH))}
        placeholder={DEFAULT_STARTING_MRN}
        minLength={MRN_MIN_LENGTH}
        maxLength={MRN_MAX_LENGTH}
        aria-invalid={error ? true : undefined}
        className="w-full max-w-xs font-mono"
        autoComplete="off"
      />
      <p className={error ? "text-xs text-destructive-text" : "text-xs text-muted-foreground"}>
        {error ??
          (mode === "create"
            ? `The clinic's patient numbers, e.g. FA-100001 or GS-00000001 — letters, numbers and -, ${MRN_MIN_LENGTH}–${MRN_MAX_LENGTH} characters, ending in at least ${MRN_MIN_DIGITS} digits. Empty = ${DEFAULT_STARTING_MRN}.`
            : "What the next patient registered will get. Change it to start a new series — patients already registered keep their MRN.")}
      </p>
    </div>
  );
}
