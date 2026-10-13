"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/core/ui/switch";
import { toast } from "@/core/ui/toast";
import { setRxPrintDoctorNameAction } from "./actions";

/**
 * The clinic's default for "Print the doctor's name" on a NEW prescription. A switch,
 * because it is a setting changed on the spot (conventions §6); each prescription can
 * still tick or untick it — this only decides where it starts.
 */
export function PrescriptionSettings({ printDoctorName }: { printDoctorName: boolean }) {
  const [on, setOn] = useState(printDoctorName);
  const [pending, start] = useTransition();
  return (
    <label className="flex items-start gap-3 text-sm">
      <Switch
        checked={on}
        disabled={pending}
        aria-label="Print the doctor's name on prescriptions"
        onCheckedChange={(next) => {
          setOn(next);
          start(async () => {
            const r = await setRxPrintDoctorNameAction(next);
            if (r.error) {
              setOn(!next);
              toast.error(r.error);
            } else toast.success(next ? "Doctor's name will print by default." : "Doctor's name is off by default.");
          });
        }}
      />
      <span>
        <span className="font-medium">Print the doctor&apos;s name on prescriptions</span>
        <span className="block text-xs text-muted-foreground">
          The default for a new prescription; it can still be changed on each one. Turn it off if your
          letterhead already shows the doctor&apos;s name.
        </span>
      </span>
    </label>
  );
}
