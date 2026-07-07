"use client";

import { Ban, Check, CheckCheck, UserX } from "lucide-react";
import { setAppointmentStatus } from "./actions";
import { Button } from "@/core/ui/button";

type Status = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";

/** Advance an appointment's status. Contextual; icon-only on mobile. */
export function AppointmentActions({
  id,
  status,
}: {
  id: string;
  status: Status;
}) {
  const done = status === "completed" || status === "cancelled";

  const action = (
    label: string,
    to: Status,
    Icon: typeof Check,
    variant: "outline" | "ghost" = "outline",
  ) => (
    <form action={setAppointmentStatus.bind(null, id, to)}>
      <Button type="submit" variant={variant} size="sm" aria-label={label}>
        <Icon className="size-4" aria-hidden="true" />
        <span className="hidden md:inline">{label}</span>
      </Button>
    </form>
  );

  if (done) {
    return <span className="text-xs text-muted-foreground">No actions</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {status === "scheduled" ? action("Confirm", "confirmed", Check) : null}
      {action("Complete", "completed", CheckCheck)}
      {action("No-show", "no_show", UserX, "ghost")}
      {action("Cancel", "cancelled", Ban, "ghost")}
    </div>
  );
}
