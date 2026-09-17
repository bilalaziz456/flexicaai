"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CalendarOff, Clock, Plus } from "lucide-react";
import { removeDoctorLeave } from "@/app/clinic/appointments/actions";
import { AddLeaveForm, type LeaveDoctor } from "@/app/clinic/schedule/leave-dialog";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { cn } from "@/core/lib/utils";

/**
 * One cell of the doctor schedule grid: what the doctor is doing that day, and a place
 * to change it.
 *
 * Clicking the cell opens the same add-leave dialog the page's buttons open, with the
 * doctor and day pre-filled — or, on a leave day, the leave itself with the option to
 * remove it. The cell shows "Add leave" in words on hover rather than relying on the
 * reader guessing it is clickable; the explicit buttons in the header and on each row
 * are the discoverable route (the owner could not find this when it was cells only).
 *
 * One cell serves both layouts: a column of the week grid on a wide screen, and a tile
 * in the stacked per-doctor list below `lg`. Neither scrolls sideways.
 *
 * Permissions are enforced server-side by the actions; `canCreate` / `canDelete` only
 * decide whether the cell is interactive, so a viewer without them gets a plain cell
 * rather than a dialog that would refuse them.
 *
 * Removing leave takes the signed-in user's password, like every other delete in the
 * app. It is asked inline rather than in a second modal, because a dialog opening on
 * top of a dialog is where focus handling goes wrong.
 */

export type CellWindow = { label: string; kind: "consultation" | "procedure" };

export function LeaveCell({
  doctorId,
  doctorName,
  doctors,
  date,
  dateLabel,
  windows,
  flexible,
  onLeave,
  leaveId,
  leaveReason,
  booked,
  dailyLimit,
  isToday,
  isPast,
  canCreate,
  canDelete,
}: {
  doctorId: string;
  doctorName: string;
  /** For the dialog's picker — the cell fixes the doctor, but the form is shared. */
  doctors: LeaveDoctor[];
  /** "YYYY-MM-DD". */
  date: string;
  /** "Mon 14 Sept", for the dialog title and the accessible name. */
  dateLabel: string;
  windows: CellWindow[];
  flexible: boolean;
  onLeave: boolean;
  leaveId: string | null;
  leaveReason: string | null;
  booked: number;
  dailyLimit: number;
  isToday: boolean;
  isPast: boolean;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const interactive = onLeave ? canDelete || canCreate : canCreate;

  const summary = onLeave
    ? `on leave${leaveReason ? ` (${leaveReason})` : ""}`
    : flexible
      ? "available any time"
      : windows.length
        ? `working ${windows.map((w) => w.label).join(", ")}`
        : "not working";

  const body = (
    <CellBody
      windows={windows}
      flexible={flexible}
      onLeave={onLeave}
      leaveReason={leaveReason}
      booked={booked}
      dailyLimit={dailyLimit}
      isToday={isToday}
      isPast={isPast}
      interactive={interactive}
      title={`${doctorName}, ${dateLabel}: ${summary}${booked ? `, ${booked} booked` : ""}`}
    />
  );

  if (!interactive) return body;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group/cell h-full w-full cursor-pointer rounded-lg text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`${doctorName}, ${dateLabel}: ${summary}${booked ? `, ${booked} booked` : ""}. ${
          onLeave ? "Manage leave" : "Add leave"
        }`}
      >
        {body}
      </button>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/50 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-[100] max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-5 text-card-foreground shadow-xl outline-none transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <Dialog.Title className="text-base font-semibold">
            {onLeave ? "Leave" : "Add leave"} · {doctorName}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {dateLabel}
            {booked > 0 && !onLeave
              ? ` · ${booked} appointment${booked === 1 ? "" : "s"} booked`
              : ""}
          </Dialog.Description>

          {onLeave && leaveId ? (
            <RemoveLeave
              leaveId={leaveId}
              reason={leaveReason}
              canDelete={canDelete}
              onDone={() => setOpen(false)}
            />
          ) : (
            <AddLeaveForm
              doctors={doctors}
              doctorId={doctorId}
              date={date}
              booked={booked}
              onDone={() => setOpen(false)}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The visible cell. Rendered on its own when the viewer cannot change anything. */
function CellBody({
  windows,
  flexible,
  onLeave,
  leaveReason,
  booked,
  dailyLimit,
  isToday,
  isPast,
  interactive,
  title,
}: {
  windows: CellWindow[];
  flexible: boolean;
  onLeave: boolean;
  leaveReason: string | null;
  booked: number;
  dailyLimit: number;
  isToday: boolean;
  isPast: boolean;
  interactive: boolean;
  title: string;
}) {
  const working = windows.length > 0 || flexible;
  const shell = cn(
    // `h-full` fills the row, so every cell in a row is the same height whatever it
    // holds — a day with two windows used to stand tall beside short neighbours.
    "flex h-full min-h-20 w-full flex-col gap-1.5 rounded-lg border p-2 transition-colors",
    isPast && "opacity-60",
    isToday && "border-primary/50 ring-1 ring-primary/30",
    onLeave
      ? "border-destructive/40 bg-destructive/10"
      : working
        ? "border-success/30 bg-success/10"
        : "border-dashed bg-muted/40",
    interactive && (onLeave ? "hover:bg-destructive/15" : "hover:bg-success/15"),
  );

  return (
    <div className={shell} title={title}>
      {onLeave ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive-text">
            <CalendarOff className="size-3.5" aria-hidden="true" />
            Leave
          </span>
          {leaveReason ? (
            <span className="line-clamp-2 text-xs text-muted-foreground">{leaveReason}</span>
          ) : null}
        </>
      ) : flexible ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-success-text">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          Any time
        </span>
      ) : windows.length ? (
        <span className="flex flex-col gap-1">
          {windows.map((w) => (
            <span
              key={`${w.kind}-${w.label}`}
              className={cn(
                "rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
                w.kind === "procedure"
                  ? "bg-info/15 text-info-text"
                  : "bg-success/20 text-success-text",
              )}
            >
              {w.label}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">Off</span>
      )}

      <span className="mt-auto flex items-center justify-between gap-2 text-2xs whitespace-nowrap text-muted-foreground">
        {booked > 0 ? (
          <span>
            {booked}
            {dailyLimit > 0 ? `/${dailyLimit}` : ""} booked
          </span>
        ) : (
          <span />
        )}
        {/* Says what the click does, rather than leaving the reader to guess. */}
        {interactive && !onLeave ? (
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-primary-text opacity-0 transition-opacity group-hover/cell:opacity-100">
            <Plus className="size-3" aria-hidden="true" />
            Add leave
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Existing leave: what it is, and the password step-up to remove it. */
function RemoveLeave({
  leaveId,
  reason,
  canDelete,
  onDone,
}: {
  leaveId: string;
  reason: string | null;
  canDelete: boolean;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeDoctorLeave(leaveId, password);
      if (result?.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm">
        {reason ? (
          <>
            Reason: <span className="text-muted-foreground">{reason}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No reason recorded.</span>
        )}
      </p>

      {canDelete ? (
        <>
          <p className="text-xs text-muted-foreground">
            Removing the leave does not restore appointments it already cancelled — those
            patients have been told the visit is off.
          </p>
          <div className="space-y-1">
            <Label htmlFor={`leave-pw-${leaveId}`} className="text-xs">
              Your password
            </Label>
            <Input
              id={`leave-pw-${leaveId}`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onDone}>
              Close
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || password.length === 0}
              onClick={remove}
            >
              {pending ? "Removing…" : "Remove leave"}
            </Button>
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
