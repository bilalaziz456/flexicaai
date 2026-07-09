"use client";

import { useActionState, useState } from "react";
import {
  createAppointment,
  doctorDayAvailability,
  searchClinicPatients,
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
const minToTime = (mins: number) =>
  `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
/** "09:30" → "9:30 AM" */
const label12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const mer = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${mer}`;
};
/** Slot start times within [start, end) at 30-min steps. */
const genSlots = (start: string, end: string) => {
  const out: string[] = [];
  for (let t = timeToMin(start); t < timeToMin(end); t += 30) out.push(minToTime(t));
  return out;
};

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * New-appointment form. The time picker ADAPTS to the doctor: a doctor with set
 * visiting hours shows a dropdown of valid slots within those hours for the
 * chosen date; a flexible doctor (or "Any doctor") shows a free time picker.
 */
export function NewAppointmentForm({
  initialPatients,
  doctors,
}: {
  initialPatients: Patient[];
  doctors: Doctor[];
}) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>(initialPatients);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [slots, setSlots] = useState<DoctorDaySlots | null>(null);
  const [state, formAction, pending] = useActionState<
    ReceptionActionState,
    FormData
  >(createAppointment, {});

  async function runSearch(q: string) {
    setQuery(q);
    setResults(await searchClinicPatients(q));
  }

  // Fetch the doctor's availability/window for the chosen date (local noon so the
  // weekday is right). Only meaningful once a specific doctor + date are picked.
  async function refreshSlots(dId: string, d: string) {
    if (!dId || !d) {
      setSlots(null);
      return;
    }
    setSlots(await doctorDayAvailability(dId, `${d}T12:00`));
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = date === todayStr;

  // Upcoming dates for the date dropdown (day + date), next ~90 days.
  const dateOptions = Array.from({ length: 90 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return {
      value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      label: d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    };
  });

  // Known up-front from the doctor list (no date needed): "Any doctor" or a
  // flexible doctor → free date+time picker. A doctor with set hours → the
  // visiting-hours slot list only.
  const selectedDoctor = doctors.find((d) => d.id === doctorId) ?? null;
  const freeTime = !doctorId || Boolean(selectedDoctor?.flexibleHours);

  const onLeaveBlock = Boolean(doctorId) && Boolean(date) && Boolean(slots?.onLeave);

  // For a specific-hours doctor: valid slots across ALL the day's windows
  // (a day can have several, e.g. 09:00–12:00 and 16:00–19:00).
  const constrained =
    !freeTime &&
    Boolean(date) &&
    slots !== null &&
    !slots.onLeave &&
    slots.available &&
    slots.windows.length > 0;
  const slotOptions = constrained
    ? Array.from(
        new Set(slots!.windows.flatMap((w) => genSlots(w.start, w.end))),
      )
        .filter((t) => !isToday || timeToMin(t) > nowMin)
        .sort()
    : [];
  const effectiveTime = freeTime
    ? time
    : slotOptions.includes(time)
      ? time
      : (slotOptions[0] ?? "");
  const scheduledAt =
    !onLeaveBlock && date && effectiveTime ? `${date}T${effectiveTime}` : "";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="patientId" value={patient?.id ?? ""} />
      <input type="hidden" name="scheduledAt" value={scheduledAt} />

      <div className="space-y-2">
        <Label>Patient</Label>
        {patient ? (
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

      <div className="grid gap-4 sm:grid-cols-2">
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
            defaultValue={30}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <select
            id="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              void refreshSlots(doctorId, e.target.value);
            }}
            className={selectCls}
          >
            <option value="">Select a date…</option>
            {dateOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label>{freeTime ? "Time" : "Available times"}</Label>
          {onLeaveBlock ? (
            <p className="text-sm text-destructive">
              Doctor is on leave that day — pick another date.
            </p>
          ) : freeTime ? (
            // Flexible doctor or "Any doctor" → free time picker.
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
          ) : slotOptions.length === 0 ? (
            <p className="text-sm text-destructive">
              No time slots left for that day.
            </p>
          ) : (
            // Specific-hours doctor → only the visiting-hours slot list.
            <select
              aria-label="Available times"
              value={effectiveTime}
              onChange={(e) => setTime(e.target.value)}
              className={selectCls}
            >
              {slotOptions.map((t) => (
                <option key={t} value={t}>
                  {label12(t)}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Input id="reason" name="reason" placeholder="e.g. Cleaning" />
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

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || !scheduledAt}>
        {pending ? "Scheduling…" : "Schedule appointment"}
      </Button>
    </form>
  );
}
