"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/core/ui/dialog";
import { CalendarOff } from "lucide-react";
import {
  addDoctorLeave,
  type LeaveActionState,
} from "@/app/clinic/appointments/actions";
import { Button } from "@/core/ui/button";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { cn } from "@/core/lib/utils";

/**
 * Adding leave, in one place — used by the page's "Add leave" button, by each doctor
 * row, and by the grid cells (which pre-fill the doctor and the day they represent).
 *
 * It exists because the cell-click alone was not discoverable: the owner could see the
 * schedule but not how to add leave to it, which is fair — a clickable cell advertises
 * nothing. The cells still work; these buttons are the obvious route.
 *
 * The doctor picker appears only when the caller has not fixed one, so the two-click
 * path from a cell stays two clicks.
 */

export type LeaveDoctor = { id: string; name: string };

export const SELECT_CLASS = cn(
  // No width here on purpose: callers set it (the picker is full-width in the form,
  // fixed in the toolbar), and a `w-full` baked in would win over either by source order.
  "h-9 rounded-lg border border-input bg-[var(--input-bg)] pr-8 pl-2.5 text-sm outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron",
);

/** The shared form body. `onDone` closes whatever dialog is holding it. */
export function AddLeaveForm({
  doctors,
  doctorId,
  date,
  booked = 0,
  onDone,
}: {
  /** Offered in a picker when `doctorId` is not set. */
  doctors: LeaveDoctor[];
  /** Fixed doctor (a cell or a row); omit to let the user choose. */
  doctorId?: string;
  /** Pre-filled day, "YYYY-MM-DD". */
  date: string;
  /** Appointments already booked that day, so the warning can be specific. */
  booked?: number;
  onDone: () => void;
}) {
  const [chosen, setChosen] = useState(doctorId ?? doctors[0]?.id ?? "");
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(date);

  // The action is bound to a doctor, so a change of doctor needs a new action.
  const action = addDoctorLeave.bind(null, chosen);
  const [state, formAction, pending] = useActionState<LeaveActionState, FormData>(action, {});

  useEffect(() => {
    if (state.saved) onDone();
  }, [state.saved, onDone]);

  const id = `${doctorId ?? "pick"}-${date}`;

  return (
    <form action={formAction} className="mt-4 space-y-3">
      {doctorId ? null : (
        <div className="space-y-1">
          <Label htmlFor={`leave-doctor-${id}`} className="text-xs">
            Doctor
          </Label>
          <select
            id={`leave-doctor-${id}`}
            className={`${SELECT_CLASS} w-full`}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`leave-from-${id}`} className="text-xs">
            From
          </Label>
          <input type="hidden" name="startDate" value={startDate} />
          <DatePicker
            id={`leave-from-${id}`}
            ariaLabel="Leave start date"
            value={startDate}
            onChange={setStartDate}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`leave-to-${id}`} className="text-xs">
            To
          </Label>
          <input type="hidden" name="endDate" value={endDate} />
          <DatePicker
            id={`leave-to-${id}`}
            ariaLabel="Leave end date"
            value={endDate}
            onChange={setEndDate}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`leave-reason-${id}`} className="text-xs">
          Reason (optional)
        </Label>
        <Input id={`leave-reason-${id}`} name="reason" placeholder="e.g. Vacation" />
      </div>

      <p className="text-xs text-muted-foreground">
        {booked > 0
          ? `${booked} appointment${booked === 1 ? "" : "s"} booked that day will be cancelled and the patients told.`
          : "For a single day, leave both dates the same. Appointments in the range are cancelled and the patients are told."}
      </p>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !chosen || !startDate || !endDate}>
          {pending ? "Saving…" : "Add leave"}
        </Button>
      </div>

      {state.error ? (
        <p className="text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** A button that opens the add-leave dialog. The page header and each row use it. */
export function AddLeaveButton({
  doctors,
  doctorId,
  date,
  label = "Add leave",
  variant = "default",
  size,
  className,
  icon,
}: {
  doctors: LeaveDoctor[];
  doctorId?: string;
  /** Day to pre-fill; the callers pass today or the first day on screen. */
  date: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  className?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const who = doctorId ? doctors.find((d) => d.id === doctorId)?.name : null;

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        {icon ?? <CalendarOff className="size-4" aria-hidden="true" />}
        {label}
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="md"
        title={
          <>
              Add leave{who ? ` · ${who}` : ""}
          </>
        }
        description={
          <>
              The doctor is marked away for these days, and cannot be booked.
          </>
        }
      >
        <AddLeaveForm
          doctors={doctors}
          doctorId={doctorId}
          date={date}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
