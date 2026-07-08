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

type Patient = { id: string; fullName: string; phone: string | null };
type Doctor = { id: string; fullName: string | null; username: string };

/** New-appointment form: pick a patient, optional doctor, date/time, reason. */
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
  const [scheduledAt, setScheduledAt] = useState("");
  const [slots, setSlots] = useState<DoctorDaySlots | null>(null);
  const [state, formAction, pending] = useActionState<
    ReceptionActionState,
    FormData
  >(createAppointment, {});

  async function runSearch(q: string) {
    setQuery(q);
    setResults(await searchClinicPatients(q));
  }

  // Show the doctor's remaining capacity once both a doctor and a date are set.
  async function refreshSlots(dId: string, when: string) {
    if (!dId || !when) {
      setSlots(null);
      return;
    }
    setSlots(await doctorDayAvailability(dId, when));
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="patientId" value={patient?.id ?? ""} />

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
              void refreshSlots(e.target.value, scheduledAt);
            }}
            className="h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <Label htmlFor="scheduledAt">Date &amp; time</Label>
          <Input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => {
              setScheduledAt(e.target.value);
              void refreshSlots(doctorId, e.target.value);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reason">Reason (optional)</Label>
          <Input id="reason" name="reason" placeholder="e.g. Cleaning" />
        </div>
      </div>

      {/* Live availability for the chosen doctor + date. */}
      {slots ? (
        <div
          className={`rounded-md border p-3 text-sm ${
            slots.available
              ? "border-border text-muted-foreground"
              : "border-destructive/40 text-destructive"
          }`}
        >
          {!slots.available ? (
            <>Doctor isn&apos;t available on that day.</>
          ) : slots.remaining === null ? (
            <>
              Available{slots.hours ? ` (${slots.hours})` : ""} · no daily limit —{" "}
              {slots.booked} booked so far.
            </>
          ) : (
            <>
              <strong className="text-foreground">
                {slots.remaining} of {slots.limit}
              </strong>{" "}
              appointment{slots.remaining === 1 ? "" : "s"} left
              {slots.hours ? ` · hours ${slots.hours}` : ""}.
            </>
          )}
        </div>
      ) : null}

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Scheduling…" : "Schedule appointment"}
      </Button>
    </form>
  );
}
