"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createAppointment,
  doctorDayAvailability,
  searchClinicPatients,
  updateAppointment,
  type DoctorDaySlots,
  type ReceptionActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { TimeSelect } from "@/core/ui/time-select";

type Patient = { id: string; fullName: string; phone: string | null };
type Doctor = {
  id: string;
  fullName: string | null;
  username: string;
  flexibleHours: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");
const timeToMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
/** "09:30" → "9:30 AM" */
const label12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${mer}`;
};

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Appointment form — create OR edit. The time picker ADAPTS to the doctor: a
 * doctor with set visiting hours shows radio buttons of the day's window(s); a
 * flexible / "Any" doctor shows a free time picker.
 *
 * Edit mode (pass `appointmentId` + `fixedPatient` + `initial`): the patient is
 * fixed, the fields are prefilled, and it saves via updateAppointment.
 */
export function NewAppointmentForm({
  initialPatients,
  doctors,
  appointmentId,
  fixedPatient,
  initial,
}: {
  initialPatients: Patient[];
  doctors: Doctor[];
  appointmentId?: string;
  fixedPatient?: { id: string; fullName: string };
  initial?: {
    doctorId: string;
    date: string;
    time: string;
    reason: string;
    durationMinutes: number;
  };
}) {
  const isEdit = Boolean(appointmentId);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>(initialPatients);
  const [doctorId, setDoctorId] = useState(initial?.doctorId ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "09:00");
  const [duration, setDuration] = useState(initial?.durationMinutes ?? 30);
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [slots, setSlots] = useState<DoctorDaySlots | null>(null);
  const action = isEdit
    ? updateAppointment.bind(null, appointmentId!)
    : createAppointment;
  const [state, formAction, pending] = useActionState<
    ReceptionActionState,
    FormData
  >(action, {});

  // React 19 auto-resets the <form> after a successful action: native form.reset()
  // unchecks the controlled radios / clears inputs, and React skips re-writing the
  // DOM because the props didn't change from the previous render — so the selection
  // desyncs (e.g. the chosen "4–7" window snaps away). Remount the field group once
  // each submit settles so the DOM is rebuilt from the current state.
  const [fieldsKey, setFieldsKey] = useState(0);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) setFieldsKey((k) => k + 1);
    wasPending.current = pending;
  }, [pending]);

  async function runSearch(q: string) {
    setQuery(q);
    setResults(await searchClinicPatients(q));
  }

  // Fetch the doctor's availability/windows for the chosen date (local noon so
  // the weekday is right). Only meaningful once a specific doctor + date are set.
  async function refreshSlots(dId: string, d: string) {
    if (!dId || !d) {
      setSlots(null);
      return;
    }
    setSlots(await doctorDayAvailability(dId, `${d}T12:00`));
  }

  // On mount (edit prefill), load the doctor's windows for the initial date.
  useEffect(() => {
    if (doctorId && date) void refreshSlots(doctorId, date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedDoctor = doctors.find((d) => d.id === doctorId) ?? null;
  const freeTime = !doctorId || Boolean(selectedDoctor?.flexibleHours);
  const onLeaveBlock = Boolean(doctorId) && Boolean(date) && Boolean(slots?.onLeave);

  const constrained =
    !freeTime &&
    Boolean(date) &&
    slots !== null &&
    !slots.onLeave &&
    slots.available &&
    slots.windows.length > 0;
  const windows = constrained ? slots!.windows : [];
  // The selected window is whichever one contains the current time.
  const selectedWindowIdx = windows.findIndex(
    (w) => timeToMin(time) >= timeToMin(w.start) && timeToMin(time) < timeToMin(w.end),
  );

  // For a specific-hours doctor, keep `time` inside a window (snap to the first
  // if it isn't — e.g. after switching doctor/date).
  useEffect(() => {
    if (freeTime || !slots) return;
    const ws = slots.windows;
    if (ws.length === 0) return;
    const inWindow = ws.some(
      (w) => timeToMin(time) >= timeToMin(w.start) && timeToMin(time) < timeToMin(w.end),
    );
    if (!inWindow) setTime(ws[0].start);
  }, [slots, freeTime, time]);

  const effectiveTime = freeTime ? time : selectedWindowIdx >= 0 ? time : "";
  const scheduledAt =
    !onLeaveBlock && date && effectiveTime ? `${date}T${effectiveTime}` : "";

  return (
    <form action={formAction} className="space-y-4">
      <input
        type="hidden"
        name="patientId"
        value={isEdit ? (fixedPatient?.id ?? "") : (patient?.id ?? "")}
      />
      <input type="hidden" name="scheduledAt" value={scheduledAt} />

      <div className="space-y-2">
        <Label>Patient</Label>
        {isEdit ? (
          <div className="text-sm font-medium">{fixedPatient?.fullName}</div>
        ) : patient ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-accent px-2.5 py-1 text-sm font-medium text-accent-foreground">
              {patient.fullName}
            </span>
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-4"
              onClick={() => setPatient(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="Search patients by name or phone…"
              value={query}
              onChange={(e) => void runSearch(e.target.value)}
            />
            <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
              {results.length === 0 ? (
                <li className="p-3 text-sm text-muted-foreground">
                  No patients found.
                </li>
              ) : (
                results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPatient(p)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="font-medium">{p.fullName}</span>
                      <span className="text-muted-foreground">{p.phone ?? ""}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      <div key={fieldsKey} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="doctorId">Doctor (optional)</Label>
          <select
            id="doctorId"
            name="doctorId"
            value={doctorId}
            onChange={(e) => {
              setDoctorId(e.target.value);
              void refreshSlots(e.target.value, date);
            }}
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
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              void refreshSlots(doctorId, e.target.value);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label>{freeTime ? "Time" : "Available times"}</Label>
          {onLeaveBlock ? (
            <p className="text-sm text-destructive">
              Doctor is on leave that day — pick another date.
            </p>
          ) : freeTime ? (
            <TimeSelect
              ariaLabel="Appointment time"
              value={effectiveTime || "09:00"}
              onChange={setTime}
            />
          ) : !date ? (
            <p className="text-sm text-muted-foreground">
              Pick a date to see the doctor&apos;s available times.
            </p>
          ) : slots === null ? (
            <p className="text-sm text-muted-foreground">Loading times…</p>
          ) : !slots.available ? (
            <p className="text-sm text-destructive">
              Doctor doesn&apos;t work that day — pick another date.
            </p>
          ) : windows.length === 0 ? (
            <p className="text-sm text-destructive">No available times that day.</p>
          ) : (
            // Specific-hours doctor → radio buttons of the visiting-hours window(s).
            <div className="space-y-1.5">
              {windows.map((w, i) => (
                <label key={i} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="window"
                    checked={selectedWindowIdx === i}
                    onChange={() => setTime(w.start)}
                    className="size-4"
                  />
                  {label12(w.start)} – {label12(w.end)}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Input
            id="reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Cleaning"
          />
        </div>
      </div>

      {/* Doctor's hours + remaining capacity for the chosen day. */}
      {slots && slots.available ? (
        <p className="text-xs text-muted-foreground">
          {slots.flexible
            ? "Flexible — book any time."
            : slots.windows.length
              ? `Working hours ${slots.windows.map((w) => `${w.start}–${w.end}`).join(", ")}.`
              : ""}
          {slots.remaining !== null
            ? ` ${slots.remaining} of ${slots.limit} appointment${slots.remaining === 1 ? "" : "s"} left that day.`
            : ""}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !scheduledAt}>
          {pending
            ? isEdit
              ? "Saving…"
              : "Scheduling…"
            : isEdit
              ? "Save changes"
              : "Schedule appointment"}
        </Button>
        {isEdit && state.saved ? (
          <span className="text-sm text-emerald-600" role="status">
            Saved.
          </span>
        ) : null}
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
