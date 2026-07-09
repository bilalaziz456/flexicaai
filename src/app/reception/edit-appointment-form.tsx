"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteAppointment,
  updateAppointment,
  type ReceptionActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { ConfirmDeleteDialog } from "@/core/ui/confirm-delete-dialog";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { TimeSelect } from "@/core/ui/time-select";

type Doctor = { id: string; fullName: string | null; username: string };

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Edit an appointment's doctor / date / time / duration / reason. Time is a
 * free picker here; the server (checkDoctorSlot) enforces the doctor's hours,
 * leave and daily cap, so an out-of-hours time is rejected with a clear message.
 */
export function EditAppointmentForm({
  appointmentId,
  doctors,
  initial,
}: {
  appointmentId: string;
  doctors: Doctor[];
  initial: {
    doctorId: string;
    date: string;
    time: string;
    reason: string;
    durationMinutes: number;
  };
}) {
  const [doctorId, setDoctorId] = useState(initial.doctorId);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const action = updateAppointment.bind(null, appointmentId);
  const [state, formAction, pending] = useActionState<
    ReceptionActionState,
    FormData
  >(action, {});

  const scheduledAt = date && time ? `${date}T${time}` : "";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="scheduledAt" value={scheduledAt} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="doctorId">Doctor</Label>
          <select
            id="doctorId"
            name="doctorId"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className={selectCls}
          >
            <option value="">— Any —</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName ?? d.username}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="durationMinutes">Duration (minutes)</Label>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={5}
            max={480}
            step={5}
            defaultValue={initial.durationMinutes}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Time</Label>
          <TimeSelect ariaLabel="Appointment time" value={time} onChange={setTime} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Input id="reason" name="reason" defaultValue={initial.reason} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !scheduledAt}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {state.saved ? (
          <span className="text-sm text-emerald-600" role="status">
            Saved.
          </span>
        ) : null}
        {state.error ? (
          <span className="text-sm text-destructive" role="alert">
            {state.error}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** Delete an appointment (step-up password), then return to the list. */
export function DeleteAppointmentButton({
  appointmentId,
}: {
  appointmentId: string;
}) {
  return (
    <ConfirmDeleteDialog
      triggerLabel="Delete appointment"
      triggerVariant="destructive"
      triggerIcon={<Trash2 className="size-4" aria-hidden="true" />}
      title="Delete appointment"
      description="Permanently delete this appointment. To just call it off, use Cancel instead."
      onConfirm={(password) => deleteAppointment(appointmentId, password)}
    />
  );
}
