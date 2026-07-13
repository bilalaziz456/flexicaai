"use client";

import { useActionState, useState } from "react";
import { CalendarOff, X } from "lucide-react";
import {
  addDoctorLeave,
  removeDoctorLeave,
  type LeaveActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";

export type LeaveItem = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string | null;
};

const fmt = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/**
 * Manage a doctor's leave / vacation days (shared by reception + clinic admin).
 * Adding a range cancels any of the doctor's appointments in it — the action
 * reports how many were cancelled.
 */
export function DoctorLeaves({
  doctorId,
  leaves,
  canCreate = true,
  canDelete = true,
}: {
  doctorId: string;
  leaves: LeaveItem[];
  /** Show the "add leave" form (leave:create). */
  canCreate?: boolean;
  /** Show the remove (×) button on each entry (leave:delete). */
  canDelete?: boolean;
}) {
  const action = addDoctorLeave.bind(null, doctorId);
  const [state, formAction, pending] = useActionState<
    LeaveActionState,
    FormData
  >(action, {});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  return (
    <div className="space-y-4">
      {leaves.length > 0 ? (
        <ul className="space-y-2">
          {leaves.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <CalendarOff
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>
                  {l.startDate === l.endDate
                    ? fmt(l.startDate)
                    : `${fmt(l.startDate)} – ${fmt(l.endDate)}`}
                  {l.reason ? (
                    <span className="text-muted-foreground"> · {l.reason}</span>
                  ) : null}
                </span>
              </span>
              {canDelete ? (
                <form action={removeDoctorLeave.bind(null, l.id)}>
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove leave"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No leave scheduled.</p>
      )}

      {canCreate ? (
      <form action={formAction} className="space-y-3 rounded-md border p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`from-${doctorId}`} className="text-xs">
              From
            </Label>
            <input type="hidden" name="startDate" value={startDate} />
            <DatePicker
              id={`from-${doctorId}`}
              ariaLabel="Leave start date"
              value={startDate}
              onChange={setStartDate}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`to-${doctorId}`} className="text-xs">
              To
            </Label>
            <input type="hidden" name="endDate" value={endDate} />
            <DatePicker
              id={`to-${doctorId}`}
              ariaLabel="Leave end date"
              value={endDate}
              onChange={setEndDate}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`reason-${doctorId}`} className="text-xs">
            Reason (optional)
          </Label>
          <Input
            id={`reason-${doctorId}`}
            name="reason"
            placeholder="e.g. Vacation"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="outline"
            disabled={pending || !startDate || !endDate}
          >
            {pending ? "Saving…" : "Add leave"}
          </Button>
          {state.saved ? (
            <span className="text-xs text-emerald-600" role="status">
              Leave added
              {typeof state.cancelled === "number" && state.cancelled > 0
                ? ` · ${state.cancelled} appointment${state.cancelled === 1 ? "" : "s"} cancelled`
                : ""}
              .
            </span>
          ) : null}
          {state.error ? (
            <span className="text-xs text-destructive" role="alert">
              {state.error}
            </span>
          ) : null}
        </div>
      </form>
      ) : null}
      {canCreate ? (
        <p className="text-xs text-muted-foreground">
          For a single day, set the same From and To date. Existing appointments in
          the range are cancelled.
        </p>
      ) : null}
    </div>
  );
}
