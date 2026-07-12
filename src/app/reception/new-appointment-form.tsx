"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Minus, Plus, Search } from "lucide-react";
import { cn } from "@/core/lib/utils";
import {
  createAppointment,
  doctorDayAvailability,
  searchClinicPatients,
  updateAppointment,
  type DoctorDaySlots,
  type ReceptionActionState,
} from "./actions";
import { Button } from "@/core/ui/button";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { TimeSelect } from "@/core/ui/time-select";
import { Toast } from "@/core/ui/toast";
import {
  computeAppointmentTotal,
  computeProcedureLine,
  formatPkr,
  type DiscountType,
} from "@/core/appointments/fee";

type Patient = { id: string; fullName: string; phone: string | null };
type Doctor = {
  id: string;
  fullName: string | null;
  username: string;
  flexibleHours: boolean;
  consultationFee: number;
};
type ProcedureOption = { id: string; name: string; price: number };

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
// Native <select> variant: themed chevron with a comfortable gap from the right
// edge (see `.select-chevron` in globals.css). Not for the discount-value input.
const nativeSelectCls =
  "h-8 w-full rounded-lg border border-input bg-[var(--input-bg)] pl-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-chevron";

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
  procedures = [],
  appointmentId,
  fixedPatient,
  initial,
}: {
  initialPatients: Patient[];
  doctors: Doctor[];
  /** The clinic's active procedures (empty unless the `sales` feature is on). */
  procedures?: ProcedureOption[];
  appointmentId?: string;
  fixedPatient?: { id: string; fullName: string };
  initial?: {
    doctorId: string;
    date: string;
    time: string;
    reason: string;
    durationMinutes: number;
    discountType: DiscountType;
    discountValue: number;
    chargeConsultation?: boolean;
    procedures?: {
      procedureId: string;
      quantity: number;
      discountType?: DiscountType;
      discountValue?: number;
    }[];
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
  const [discountType, setDiscountType] = useState<DiscountType>(
    initial?.discountType ?? "amount",
  );
  // Kept as a string so the field can be emptied while typing (a numeric state
  // would snap a cleared field back to 0). Parsed to a number where needed; a
  // blank/invalid value is treated as 0 (no discount).
  const [discountValue, setDiscountValue] = useState(
    initial?.discountValue ? String(initial.discountValue) : "",
  );
  const discountNumber = Math.max(0, Number(discountValue) || 0);
  // A procedure-only visit can skip the doctor's consultation fee.
  const [chargeConsultation, setChargeConsultation] = useState(
    initial?.chargeConsultation ?? true,
  );
  // Selected procedures → { quantity (≥1), per-line discount }. `discountValue` is
  // a string so the field can be cleared while typing. Missing key = unselected.
  type ProcState = {
    quantity: number;
    discountType: DiscountType;
    discountValue: string;
  };
  const [procSel, setProcSel] = useState<Map<string, ProcState>>(() => {
    const m = new Map<string, ProcState>();
    for (const it of initial?.procedures ?? []) {
      m.set(it.procedureId, {
        quantity: Math.max(1, it.quantity),
        discountType: it.discountType ?? "amount",
        discountValue: it.discountValue ? String(it.discountValue) : "",
      });
    }
    return m;
  });
  const updateProc = (id: string, patch: Partial<ProcState>) =>
    setProcSel((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(id, { ...cur, ...patch });
      return next;
    });
  const toggleProc = (id: string) =>
    setProcSel((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { quantity: 1, discountType: "amount", discountValue: "" });
      return next;
    });
  const setQty = (id: string, q: number) =>
    setProcSel((prev) => {
      if (q <= 0) {
        const next = new Map(prev);
        next.delete(id);
        return next;
      }
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(id, { ...cur, quantity: Math.min(99, q) });
      return next;
    });
  // Per-procedure net (line gross − its own discount), and the sum across lines.
  const procLine = (p: ProcedureOption) => {
    const s = procSel.get(p.id);
    if (!s) return null;
    return computeProcedureLine({
      unitPrice: p.price,
      quantity: s.quantity,
      discountType: s.discountType,
      discountValue: Math.max(0, Number(s.discountValue) || 0),
    });
  };
  const proceduresTotal = procedures
    .filter((p) => procSel.has(p.id))
    .reduce((sum, p) => sum + (procLine(p)?.net ?? 0), 0);
  const [slots, setSlots] = useState<DoctorDaySlots | null>(null);
  const action = isEdit
    ? updateAppointment.bind(null, appointmentId!)
    : createAppointment;
  const [state, formAction, pending] = useActionState<
    ReceptionActionState,
    FormData
  >(action, {});

  // Re-trigger the error toast on every failed submit — `state` is a fresh
  // object each time the action settles, so this bumps even for an identical
  // error message on a second attempt.
  const [errorNonce, setErrorNonce] = useState(0);
  useEffect(() => {
    if (state.error) setErrorNonce((n) => n + 1);
  }, [state]);

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
  const consultationFee = selectedDoctor?.consultationFee ?? 0;
  // Live bill preview: consultation fee (if charged) + procedures, minus discount.
  const bill = computeAppointmentTotal(
    chargeConsultation ? consultationFee : 0,
    proceduresTotal,
    discountType,
    discountNumber,
  );
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
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search patients by name or phone…"
                value={query}
                onChange={(e) => void runSearch(e.target.value)}
                aria-label="Search patients"
              />
            </div>
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
            className={nativeSelectCls}
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
          <DatePicker
            id="date"
            ariaLabel="Appointment date"
            value={date}
            onChange={(v) => {
              setDate(v);
              void refreshSlots(doctorId, v);
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
            // Specific-hours doctor → pick one of the visiting-hours window(s).
            // These are buttons (not <input type="radio">) on purpose: React 19
            // auto-resets the <form> after a successful save, and native
            // form.reset() would clear a real radio and make the selection flash.
            // As React-state-only controls they're immune to the reset; the value
            // is submitted via the hidden `scheduledAt`.
            <div role="radiogroup" aria-label="Available times" className="space-y-1.5">
              {windows.map((w, i) => {
                const checked = selectedWindowIdx === i;
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => setTime(w.start)}
                    className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span
                      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border ${
                        checked ? "border-primary" : "border-input"
                      }`}
                    >
                      {checked ? (
                        <span className="size-2 rounded-full bg-primary" />
                      ) : null}
                    </span>
                    {label12(w.start)} – {label12(w.end)}
                  </button>
                );
              })}
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

        {/* Consultation fee — its OWN section, separate from procedures. It comes
            from the doctor's set fee (staff → doctor), so it appears the moment a
            doctor is selected. Uncheck to skip it for a procedure-only visit. The
            hidden field always submits the decision (unchecked boxes don't post). */}
        <input
          type="hidden"
          name="chargeConsultation"
          value={chargeConsultation ? "1" : "0"}
        />
        {selectedDoctor ? (
          <div className="space-y-2 rounded-lg border p-3 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="font-medium">Consultation fee</Label>
              <span className="text-sm font-semibold">
                {consultationFee > 0 ? formatPkr(consultationFee) : "Not set"}
              </span>
            </div>
            {consultationFee > 0 ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chargeConsultation}
                    onChange={(e) => setChargeConsultation(e.target.checked)}
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  Charge this consultation fee
                </label>
                <p className="text-xs text-muted-foreground">
                  Uncheck if the patient is coming only for a procedure.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                This doctor has no consultation fee set — add it under Staff.
              </p>
            )}
          </div>
        ) : null}

        {/* Procedures the patient is booked for — priced line items that add to
            the appointment total. Only shown when the clinic has procedures. */}
        {procedures.length > 0 ? (
          <div className="space-y-2 sm:col-span-2">
            <Label>Procedures (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {procedures.map((p) => {
                const checked = procSel.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleProc(p.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      checked ? "border-primary bg-primary/10" : "hover:bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-4 shrink-0 items-center justify-center rounded border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {checked ? <Check className="size-3" aria-hidden="true" /> : null}
                    </span>
                    {p.name} · {formatPkr(p.price)}
                  </button>
                );
              })}
            </div>

            {/* Per-procedure quantity, its own discount, and the line net. */}
            {procSel.size > 0 ? (
              <ul className="divide-y rounded-lg border">
                {procedures
                  .filter((p) => procSel.has(p.id))
                  .map((p) => {
                    const s = procSel.get(p.id)!;
                    const line = procLine(p)!;
                    return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate font-medium">
                          {p.name}
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {formatPkr(p.price)}
                          </span>
                        </span>
                        <div className="flex flex-wrap items-center gap-3">
                          {/* quantity */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Decrease ${p.name} quantity`}
                              onClick={() => setQty(p.id, s.quantity - 1)}
                              className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-accent"
                            >
                              <Minus className="size-3.5" aria-hidden="true" />
                            </button>
                            <span className="w-6 text-center tabular-nums" aria-live="polite">
                              {s.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Increase ${p.name} quantity`}
                              onClick={() => setQty(p.id, s.quantity + 1)}
                              className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-accent"
                            >
                              <Plus className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                          {/* per-line discount */}
                          <div className="flex items-center gap-1">
                            <select
                              value={s.discountType}
                              onChange={(e) =>
                                updateProc(p.id, {
                                  discountType: e.target.value as DiscountType,
                                })
                              }
                              className={`${nativeSelectCls} h-7 w-auto`}
                              aria-label={`${p.name} discount type`}
                            >
                              <option value="amount">Rs</option>
                              <option value="percent">%</option>
                            </select>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={s.discountType === "percent" ? 100 : undefined}
                              value={s.discountValue}
                              onChange={(e) =>
                                updateProc(p.id, {
                                  discountValue: e.target.value.replace(/[^\d]/g, ""),
                                })
                              }
                              placeholder="Disc."
                              aria-label={`${p.name} discount`}
                              className={`${selectCls} h-7 w-16`}
                            />
                          </div>
                          <span className="w-24 text-right font-medium tabular-nums">
                            {line.discount > 0 ? (
                              <span className="mr-1 font-normal text-muted-foreground line-through">
                                {formatPkr(line.gross)}
                              </span>
                            ) : null}
                            {formatPkr(line.net)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            ) : null}

            {/* One hidden field per procedure: "<id>:<qty>:<type>:<discountValue>". */}
            {[...procSel.entries()].map(([id, s]) => (
              <input
                key={id}
                type="hidden"
                name="procedure"
                value={`${id}:${s.quantity}:${s.discountType}:${Math.max(0, Number(s.discountValue) || 0)}`}
              />
            ))}
          </div>
        ) : null}

        {/* Discount off the whole bill (consultation fee + procedures). Default
            type is Amount (flat PKR); switch to Percent for a % of the total. */}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="discountValue">Discount (optional)</Label>
          <div className="flex gap-2">
            <select
              id="discountType"
              name="discountType"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as DiscountType)}
              className={`${nativeSelectCls} w-auto`}
              aria-label="Discount type"
            >
              <option value="amount">Amount (Rs)</option>
              <option value="percent">Percent (%)</option>
            </select>
            <Input
              id="discountValue"
              name="discountValue"
              type="number"
              inputMode="numeric"
              min={0}
              max={discountType === "percent" ? 100 : undefined}
              step={discountType === "percent" ? 1 : 50}
              value={discountValue}
              onChange={(e) => {
                // Digits only; allow empty so the field can be cleared.
                const v = e.target.value.replace(/[^\d]/g, "");
                setDiscountValue(v);
              }}
              placeholder={discountType === "percent" ? "e.g. 20" : "e.g. 500"}
            />
          </div>
          {bill.gross > 0 ? (
            (() => {
              const parts: string[] = [];
              if (bill.consultation > 0) parts.push(`${formatPkr(bill.consultation)} fee`);
              if (bill.procedures > 0) parts.push(`${formatPkr(bill.procedures)} procedures`);
              const lhs =
                parts.length > 1 ? `${parts.join(" + ")} = ${formatPkr(bill.gross)}` : parts[0];
              return (
                <p className="text-sm text-muted-foreground">
                  {lhs}
                  {bill.discount > 0 ? ` − ${formatPkr(bill.discount)} discount` : ""} ={" "}
                  <span className="font-medium text-foreground">{formatPkr(bill.net)}</span>
                </p>
              );
            })()
          ) : selectedDoctor ? (
            <p className="text-sm text-muted-foreground">
              {consultationFee > 0
                ? "Consultation fee not charged and no procedures selected."
                : "No consultation fee set and no procedures selected."}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick a doctor or procedures to see the total.
            </p>
          )}
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
      </div>

      {/* Failed create/edit → error toast (re-triggered per attempt via nonce). */}
      <Toast message={state.error ?? null} variant="error" token={errorNonce} />
    </form>
  );
}
