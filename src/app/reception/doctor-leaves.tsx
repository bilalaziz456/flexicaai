"use client";

import { useActionState, useEffect, useState } from "react";
import { CalendarOff, Pencil, X } from "lucide-react";
import {
  addDoctorLeave,
  removeDoctorLeave,
  updateDoctorLeave,
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
 * A single existing leave entry: read-only summary with Edit / Remove controls,
 * plus an inline edit form (dates + reason) toggled by Edit. Edit is gated by
 * `canEdit` (leave:edit), Remove by `canDelete` (leave:delete) — the server
 * action re-checks the permission and, for a doctor, that it's their own leave.
 */
function LeaveEntry({
  leave,
  canEdit,
  canDelete,
}: {
  leave: LeaveItem;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const action = updateDoctorLeave.bind(null, leave.id);
  const [state, formAction, pending] = useActionState<LeaveActionState, FormData>(
    action,
    {},
  );
  const [startDate, setStartDate] = useState(leave.startDate);
  const [endDate, setEndDate] = useState(leave.endDate);
  const [reason, setReason] = useState(leave.reason ?? "");

  // Close the editor once a save succeeds (the list re-renders from the server).
  useEffect(() => {
    if (state.saved) setEditing(false);
  }, [state.saved]);

  if (editing) {
    return (
      <li className="rounded-md border p-3">
        <form action={formAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`edit-from-${leave.id}`} className="text-xs">
                From
              </Label>
              <input type="hidden" name="startDate" value={startDate} />
              <DatePicker
                id={`edit-from-${leave.id}`}
                ariaLabel="Leave start date"
                value={startDate}
                onChange={setStartDate}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`edit-to-${leave.id}`} className="text-xs">
                To
              </Label>
              <input type="hidden" name="endDate" value={endDate} />
              <DatePicker
                id={`edit-to-${leave.id}`}
                ariaLabel="Leave end date"
                value={endDate}
                onChange={setEndDate}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`edit-reason-${leave.id}`} className="text-xs">
              Reason (optional)
            </Label>
            <Input
              id={`edit-reason-${leave.id}`}
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Vacation"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !startDate || !endDate}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStartDate(leave.startDate);
                setEndDate(leave.endDate);
                setReason(leave.reason ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            {state.error ? (
              <span className="text-xs text-destructive" role="alert">
                {state.error}
              </span>
            ) : null}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
      <span className="flex items-center gap-2">
        <CalendarOff
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span>
          {leave.startDate === leave.endDate
            ? fmt(leave.startDate)
            : `${fmt(leave.startDate)} – ${fmt(leave.endDate)}`}
          {leave.reason ? (
            <span className="text-muted-foreground"> · {leave.reason}</span>
          ) : null}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Edit leave"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        {canDelete ? (
          <form action={removeDoctorLeave.bind(null, leave.id)}>
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
      </span>
    </li>
  );
}

/**
 * Manage a doctor's leave / vacation days (shared by reception + clinic admin +
 * the doctor's own dashboard). Adding or editing a range cancels any of the
 * doctor's appointments in it — the action reports how many were cancelled.
 */
export function DoctorLeaves({
  doctorId,
  leaves,
  canCreate = true,
  canEdit = true,
  canDelete = true,
}: {
  doctorId: string;
  leaves: LeaveItem[];
  /** Show the "add leave" form (leave:create). */
  canCreate?: boolean;
  /** Show the Edit control on each entry (leave:edit). */
  canEdit?: boolean;
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
            <LeaveEntry
              key={l.id}
              leave={l}
              canEdit={canEdit}
              canDelete={canDelete}
            />
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
