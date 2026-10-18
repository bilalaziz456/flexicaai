"use client";

import { useTenderOptions } from "@/core/ui/vocabulary-provider";
import { ActionForm } from "@/core/ui/action-form";
import { startTransition, useActionState, useRef, useState } from "react";
import { Check, Minus, Plus, Printer, Search, X } from "lucide-react";
import { cn } from "@/core/lib/utils";
import {
  createAppointment,
  doctorDayAvailability,
  searchClinicPatients,
  updateAppointment,
  type DoctorDaySlots,
  type ReceptionActionState,
} from "@/app/clinic/appointments/actions";
import { SelectField } from "@/core/ui/select-field";
import { Checkbox } from "@/core/ui/checkbox";
import { Button } from "@/core/ui/button";
import { Dialog } from "@/core/ui/dialog";
import { DatePicker } from "@/core/ui/date-picker";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { TimeSelect } from "@/core/ui/time-select";
import { useActionToast } from "@/core/ui/toast";
import { SearchableSelect } from "@/core/ui/searchable-select";
import { syncChecked } from "@/core/ui/checkbox-sync";
import { discountByLabel, isPlanDiscount, visitPlanDiscount } from "@/core/patients/plan-bill";
import type { BookablePlanItem } from "@/core/patients/treatment-plans";
import {
  MAX_DISCOUNT_PERCENT,
  computeBill,
  computeFee,
  formatPkr,
  type DiscountType,
} from "@/core/appointments/fee";
import {
  describeOfferDiscount,
  offerForVisit,
  offerLabel,
  type ProcedureOffer,
} from "@/core/appointments/procedure-offer";

type Patient = { id: string; fullName: string; phone: string | null; mrn?: string | null };
type Doctor = {
  id: string;
  fullName: string | null;
  username: string;
  flexibleHours: boolean;
  consultationFee: number;
};
type ProcedureOption = {
  id: string;
  name: string;
  price: number;
  offer?: ProcedureOffer;
  /** A service (room, X-ray, medicines): its own section, price editable, no offer. */
  isService?: boolean;
};
/** A one-off "other charge" typed on the bill — not on any price list. */
type OtherCharge = { key: string; name: string; price: string; quantity: number };
/** The longest description a one-off charge may carry (matches the server). */
const OTHER_CHARGE_NAME_MAX = 80;

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
  procedures: allOptions = [],
  clinicName,
  appointmentId,
  fixedPatient,
  preselectedPatient,
  preselectedDate,
  preselectedTime,
  planItems = [],
  papers = [],
  initial,
  initialSlots,
  invoiceMode = false,
  canTakePayment = false,
  chargesEnabled = false,
}: {
  initialPatients: Patient[];
  doctors: Doctor[];
  /** The clinic's active procedures AND services (empty unless the `sales` feature is
   *  on); split into their two sections here by `isService`. */
  procedures?: ProcedureOption[];
  /** The clinic bills (sales feature on): offer "+ Add other charge" even when the
   *  services list is empty. */
  chargesEnabled?: boolean;
  /** Names the offer on a procedure line ("Clinic002 offer · 10% discount"). */
  clinicName?: string | null;
  /** Unscheduled treatment-plan items for the (preselected) patient — booking-from-plan. */
  /** The patient's bookable plan items, with their offer and plan discount. */
  planItems?: BookablePlanItem[];
  /** The paper sizes the clinic prints on — one "Save & print <size>" button each. */
  papers?: readonly string[];
  appointmentId?: string;
  fixedPatient?: { id: string; fullName: string };
  /** Create mode: start with this patient chosen (from "Book" on a patient row),
   *  still changeable. */
  preselectedPatient?: Patient | null;
  /** Create mode: start on this date (the day the appointments list was showing),
   *  still changeable. Ignored in edit mode, where  is the real one. */
  preselectedDate?: string;
  /** Create mode: start at this time (HH:MM) — the Invoices page passes "now",
   *  computed on the SERVER so the first render matches on both sides. */
  preselectedTime?: string;
  /** The Invoices page's form: create a visit AND its invoice, with the payment taken
   *  (owner's call, 2026-10-12). Defaults to now, with the time free (an invoice is
   *  usually for a visit happening or just happened), adds a Payment section, and
   *  the server completes the visit and records the payment. In edit mode it only
   *  changes the button wording. */
  invoiceMode?: boolean;
  /** New appointment: offer an optional Payment received section (an advance taken
   *  at booking). Billing on + the person may record payments; decided by the page. */
  canTakePayment?: boolean;
  /** Edit mode: the doctor's windows for the appointment's own date, resolved on the
   *  server so the time picker is already constrained when the page paints. */
  initialSlots?: DoctorDaySlots | null;
  initial?: {
    doctorId: string;
    date: string;
    time: string;
    reason: string;
    durationMinutes: number;
    discountType: DiscountType;
    discountValue: number;
    discountBorneBy?: string;
    discountSplitType?: string;
    discountSplitValue?: number;
    chargeConsultation?: boolean;
    customTime?: boolean;
    procedures?: {
      procedureId: string;
      quantity: number;
      discountType?: DiscountType;
      discountValue?: number;
      /** The price the line was billed at — a service keeps it on an edit. */
      unitPrice?: number;
    }[];
    /** One-off charges already on the bill, so an edit keeps them. */
    otherCharges?: { name: string; unitPrice: number; quantity: number }[];
  };
}) {
  const isEdit = Boolean(appointmentId);
  const newInvoice = invoiceMode && !isEdit;
  // Payment with the save: always on a new invoice, optional on a new appointment;
  // both start at the bill total.
  const showPayment = newInvoice || (!isEdit && canTakePayment);
  const methodOptions = useTenderOptions();
  // Payment taken with the invoice. Follows the bill until the person types an
  // amount — then it is theirs (a part payment, or nothing yet).
  const [payTouched, setPayTouched] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [patient, setPatient] = useState<Patient | null>(preselectedPatient ?? null);
  const [planItemSel, setPlanItemSel] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Patient[]>(initialPatients);
  const [doctorId, setDoctorId] = useState(initial?.doctorId ?? "");
  // `initial.date` wins over the prefill: in edit mode it IS the appointment's own
  // date, and a stray `?date=` must never silently move a booking that exists.
  const [date, setDate] = useState(initial?.date ?? preselectedDate ?? "");
  const [rawTime, setTime] = useState(initial?.time ?? preselectedTime ?? "09:00");
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
  // Who absorbs the discount: the clinic, the appointment's doctor, or split between
  // them (only matters once a discount is entered).
  const [borneBy, setBorneBy] = useState<"clinic" | "doctor" | "split">(
    initial?.discountBorneBy === "doctor" || initial?.discountBorneBy === "split"
      ? initial.discountBorneBy
      : "clinic",
  );
  // For borne-by = "split": how much of the discount the DOCTOR side bears.
  const [splitType, setSplitType] = useState<DiscountType>(
    initial?.discountSplitType === "amount" ? "amount" : "percent",
  );
  const [splitValue, setSplitValue] = useState(
    initial?.discountSplitValue ? String(initial.discountSplitValue) : "",
  );
  const splitNumber = Math.max(0, Number(splitValue) || 0);
  // A procedure-only visit can skip the doctor's consultation fee.
  // A new invoice starts WITHOUT the consultation fee (owner's call, 2026-10-12): it
  // is usually for procedures, and the fee is ticked on when it applies.
  const [chargeConsultation, setChargeConsultation] = useState(
    initial?.chargeConsultation ?? !newInvoice,
  );
  // A new invoice bills a visit that is happening now — the doctor's visiting hours
  // are not a reason to refuse it, so it starts with the time free.
  const [customTime, setCustomTime] = useState(initial?.customTime ?? newInvoice);
  // The one list the page sends holds both price lists; each gets its own section.
  const serviceIds = new Set(allOptions.filter((p) => p.isService).map((p) => p.id));
  const procedures = allOptions.filter((p) => !p.isService);
  const services = allOptions.filter((p) => p.isService);
  // Selected procedures → { quantity (≥1) }. Missing key = unselected. A line's
  // discount is not chosen here — it is the clinic offer (see `lineDiscount`).
  type ProcState = { quantity: number };
  const [procSel, setProcSel] = useState<Map<string, ProcState>>(() => {
    const m = new Map<string, ProcState>();
    for (const it of initial?.procedures ?? []) {
      if (serviceIds.has(it.procedureId)) continue;
      m.set(it.procedureId, { quantity: Math.max(1, it.quantity) });
    }
    return m;
  });
  // Selected services → quantity + the price on THIS bill (starts at the list price,
  // or what an edited visit was billed at; the server honours it for services only).
  type SvcState = { quantity: number; price: string };
  const [svcSel, setSvcSel] = useState<Map<string, SvcState>>(() => {
    const m = new Map<string, SvcState>();
    for (const it of initial?.procedures ?? []) {
      if (!serviceIds.has(it.procedureId)) continue;
      const listPrice = allOptions.find((o) => o.id === it.procedureId)?.price ?? 0;
      m.set(it.procedureId, {
        quantity: Math.max(1, it.quantity),
        price: String(it.unitPrice ?? listPrice),
      });
    }
    return m;
  });
  const toggleSvc = (id: string, listPrice: number) =>
    setSvcSel((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { quantity: 1, price: String(listPrice) });
      return next;
    });
  const patchSvc = (id: string, patch: Partial<SvcState>) =>
    setSvcSel((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      const merged = { ...cur, ...patch };
      if (merged.quantity <= 0) next.delete(id);
      else next.set(id, { ...merged, quantity: Math.min(99, merged.quantity) });
      return next;
    });
  // One-off charges ("Medicines Rs 2,000") — typed here, not picked from a list.
  const [charges, setCharges] = useState<OtherCharge[]>(() =>
    (initial?.otherCharges ?? []).map((c, i) => ({
      key: `saved-${i}`,
      name: c.name,
      price: String(c.unitPrice),
      quantity: Math.max(1, c.quantity),
    })),
  );
  const addCharge = () =>
    setCharges((prev) => [...prev, { key: crypto.randomUUID(), name: "", price: "", quantity: 1 }]);
  const patchCharge = (key: string, patch: Partial<OtherCharge>) =>
    setCharges((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const removeCharge = (key: string) => setCharges((prev) => prev.filter((c) => c.key !== key));
  const priceOf = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  // A charge only counts once it has a description — the server drops nameless ones.
  const liveCharges = charges.filter((c) => c.name.trim().length > 0);
  const toggleProc = (id: string) =>
    setProcSel((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { quantity: 1 });
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
      next.set(id, { quantity: Math.min(99, q) });
      return next;
    });
  // A line's discount is never typed here: it is the CLINIC OFFER, which the server
  // applies (`applyClinicOffers`). This preview follows the same rule so the total on
  // screen is the total saved — on an edit, a line the visit already had keeps the
  // discount it was booked with; anything else takes the offer running on the visit
  // date picked above.
  const bookedLineDiscount = new Map(
    (initial?.procedures ?? []).map((it) => [
      it.procedureId,
      { type: it.discountType ?? ("amount" as DiscountType), value: it.discountValue ?? 0 },
    ]),
  );
  const lineDiscount = (p: ProcedureOption): { type: DiscountType; value: number } | null => {
    const booked = bookedLineDiscount.get(p.id);
    if (booked) return booked.value > 0 ? booked : null;
    return p.offer && date ? offerForVisit(p.offer, date) : null;
  };
  const procLine = (p: ProcedureOption) => {
    const s = procSel.get(p.id);
    if (!s) return null;
    const gross = p.price * s.quantity;
    const d = lineDiscount(p);
    const off = d ? computeFee(gross, d.type, d.value).discount : 0;
    return { gross, net: gross - off, offer: d && off > 0 ? d : null };
  };
  // The selected lines, in the shape the shared bill takes — through `computeBill`,
  // so the preview uses the same formula as the invoice it will become.
  const procedureBillLines = procedures
    .filter((p) => procSel.has(p.id))
    .map((p) => {
      const d = lineDiscount(p);
      return {
        unitPrice: p.price,
        quantity: procSel.get(p.id)!.quantity,
        discountType: d?.type ?? ("amount" as DiscountType),
        discountValue: d?.value ?? 0,
      };
    });
  // A service takes its clinic offer exactly as a procedure does (2026-10-18) — on the
  // price as billed, which the desk may have changed. One-off charges carry none.
  const otherBillLines = [
    ...services
      .filter((p) => svcSel.has(p.id))
      .map((p) => {
        const s = svcSel.get(p.id)!;
        const d = lineDiscount(p);
        return {
          unitPrice: priceOf(s.price),
          quantity: s.quantity,
          discountType: d?.type ?? ("amount" as DiscountType),
          discountValue: d?.value ?? 0,
        };
      }),
    ...liveCharges.map((c) => ({
      unitPrice: priceOf(c.price),
      quantity: c.quantity,
      discountType: "amount" as DiscountType,
      discountValue: 0,
    })),
  ];
  // After each line's offer, so "procedures + other charges" still adds up to the subtotal.
  const otherChargesTotal = otherBillLines.reduce(
    (sum, l) => sum + l.unitPrice * l.quantity - computeFee(l.unitPrice * l.quantity, l.discountType, l.discountValue).discount,
    0,
  );
  // Plan items ticked below bill as procedure lines with their snapshotted offer —
  // exactly how the server books them (scheduleItemsOnAppointment). Left out, the
  // total on screen was lower than the one saved.
  const selectedPlanItems = planItems.filter((it) => planItemSel.has(it.id));
  const planBillLines = selectedPlanItems.map((it) => ({
    unitPrice: it.unitPrice,
    quantity: it.quantity,
    discountType: it.offerType,
    discountValue: it.offerValue,
  }));
  const billLines = [...procedureBillLines, ...planBillLines, ...otherBillLines];
  // The discount the ticked items bring from their plan, and whether the form still
  // holds exactly that one (then it needs no approval — the server checks the same).
  const planTerms = visitPlanDiscount(selectedPlanItems);
  const planDiscount = planTerms && !("error" in planTerms) ? planTerms : null;
  const discountIsPlan = isPlanDiscount(planDiscount, {
    discountType,
    discountValue: discountNumber,
    borneBy,
    splitType,
    splitValue: borneBy === "split" ? splitNumber : 0,
  });
  const planDoctorName = selectedPlanItems.find((it) => it.planDiscount > 0)?.doctorName ?? null;

  // Ticking a plan item fills the discount in from the plan. Only while the discount
  // still is the plan's (or empty): one the desk typed is theirs and is left alone.
  const togglePlanItem = (id: string) => {
    const next = new Set(planItemSel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPlanItemSel(next);
    if (!discountIsPlan && discountNumber > 0) return;
    const terms = visitPlanDiscount(planItems.filter((it) => next.has(it.id)));
    if (terms && "error" in terms) return;
    setDiscountType("amount");
    setDiscountValue(terms ? String(terms.amount) : "");
    setBorneBy(terms ? terms.borneBy : "clinic");
    if (terms?.borneBy === "split") {
      setSplitType(terms.split.type);
      setSplitValue(String(terms.split.value));
    }
  };
  // Seeded by the server when editing, so the picker is constrained on the first
  // paint. It used to be null with an effect that fetched the same thing on mount:
  // a round trip after hydration, and a moment where the form offered times the
  // doctor does not work. The create flow has no doctor yet, so it passes nothing.
  const [slots, setSlots] = useState<DoctorDaySlots | null>(initialSlots ?? null);
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
  useActionToast(state, { saved: invoiceMode ? "Invoice saved." : "Changes saved.", error: true });

  // Same-day duplicate: the action answered with a question instead of saving.
  // Open for THAT answer only — keyed on the state object's identity, so closing it
  // stays closed until the next submit asks again, with no effect to sync it.
  const formRef = useRef<HTMLFormElement>(null);
  const [dismissedDuplicate, setDismissedDuplicate] = useState<ReceptionActionState | null>(null);
  const duplicateOpen = Boolean(state.duplicate) && dismissedDuplicate !== state;
  // Which save button was pressed (Save vs Save & print). The same-day question
  // resubmits from the form itself, which has no submitter — so remember it.
  const thenRef = useRef("");
  // "Save & print thermal / A4 / A5" — only the sizes the clinic prints on, in the
  // order the desk reaches for them.
  const printPapers = (["thermal", "a4", "a5"] as const).filter((k) => papers.includes(k));
  // A function, called where the buttons render: it reads `scheduledAt`, which is
  // declared further down this component.
  const printButtons = () => printPapers.map((k) => (
    <Button
      key={k}
      type="submit"
      name="then"
      value={`print:${k}`}
      disabled={pending || !scheduledAt}
      onClick={() => (thenRef.current = `print:${k}`)}
    >
      <Printer aria-hidden="true" /> {pending ? "Saving…" : `Save & print ${k === "thermal" ? "thermal" : k.toUpperCase()}`}
    </Button>
  ));
  function bookAnyway() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("confirmDuplicate", "1");
    if (thenRef.current) fd.set("then", thenRef.current);
    setDismissedDuplicate(state);
    startTransition(() => formAction(fd));
  }

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

  const selectedDoctor = doctors.find((d) => d.id === doctorId) ?? null;
  const doctorOptions = [
    { value: "", label: "— Any —" },
    ...doctors.map((d) => ({ value: d.id, label: d.fullName ?? d.username })),
  ];
  const consultationFee = selectedDoctor?.consultationFee ?? 0;
  // Live bill preview: consultation fee (if charged) + procedures, minus discount.
  const bill = computeBill(
    chargeConsultation ? consultationFee : 0,
    billLines,
    discountType,
    discountNumber,
  );
  // A custom time frees the picker exactly as a flexible doctor does — the server
  // applies the same relaxation (checkDoctorSlot's `customTime`), so the form can
  // never offer a time the action would then refuse.
  // A NEW INVOICE has no time to choose (owner's call, 2026-10-18 — it is billing,
  // not booking): it takes the time the page opened at, and is never held to the
  // doctor's visiting hours, so it is "free" and is sent as a custom time below.
  const freeTime = newInvoice || !doctorId || Boolean(selectedDoctor?.flexibleHours) || customTime;
  const onLeaveBlock = Boolean(doctorId) && Boolean(date) && Boolean(slots?.onLeave);

  // Whether this visit carries procedures decides which windows the SERVER will
  // accept (checkDoctorSlot widens to procedure windows only then), so the form
  // offers exactly that set — never more, never less. Note it's the procedures,
  // not the consultation-fee checkbox: a visit can skip the fee and still be a
  // plain consultation, which a procedure window would refuse.
  const hasProcedures = procSel.size > 0;

  const constrained =
    !freeTime &&
    Boolean(date) &&
    slots !== null &&
    !slots.onLeave &&
    slots.available &&
    slots.windows.length > 0;
  const windows = constrained
    ? slots!.windows.filter((w) => hasProcedures || w.kind !== "procedure")
    : [];
  const inWindow = (t: string, w: { start: string; end: string }) =>
    timeToMin(t) >= timeToMin(w.start) && timeToMin(t) < timeToMin(w.end);

  // The time actually in play. A time outside every BOOKABLE window snaps to the
  // first one — after switching doctor or date, and after removing the last
  // procedure, which can strand it inside a procedure window that no longer applies.
  //
  // DERIVED, not corrected. This was an effect that wrote the snapped value back into
  // state, so the form rendered once showing a time it was about to reject and again
  // with the right one; the effect also listed `time` among its dependencies, which
  // is a state update watching the state it updates. Computing it here means the
  // first render is already correct and there is nothing to keep in step.
  const time =
    windows.length > 0 && !windows.some((w) => inWindow(rawTime, w)) ? windows[0].start : rawTime;

  // With the override ON, is the chosen time inside the doctor's hours ANYWAY? The
  // server asks exactly this (checkDoctorSlot's `withinHours`) and drops the flag when
  // it is true, so without saying so here the form silently disagrees with what gets
  // saved: staff tick "Custom time", pick a time that turns out to be in hours, and
  // then wonder why the visit appears on the normal queue card instead of its own.
  const customTimeUnnecessary =
    customTime &&
    Boolean(doctorId) &&
    !selectedDoctor?.flexibleHours &&
    Boolean(time) &&
    slots !== null &&
    !slots.onLeave &&
    slots.available &&
    slots.windows
      .filter((w) => hasProcedures || w.kind !== "procedure")
      .some((w) => inWindow(time, w));

  // The selected window is whichever one contains the current time.
  const selectedWindowIdx = windows.findIndex((w) => inWindow(time, w));

  const effectiveTime = freeTime ? time : selectedWindowIdx >= 0 ? time : "";
  const scheduledAt =
    !onLeaveBlock && date && effectiveTime ? `${date}T${effectiveTime}` : "";

  return (
    <ActionForm ref={formRef} action={formAction} state={state} className="space-y-4">
      <input
        type="hidden"
        name="patientId"
        value={isEdit ? (fixedPatient?.id ?? "") : (patient?.id ?? "")}
      />
      <input type="hidden" name="scheduledAt" value={scheduledAt} />
      <input type="hidden" name="customTime" value={customTime || newInvoice ? "1" : "0"} />
      {newInvoice ? <input type="hidden" name="asInvoice" value="1" /> : null}

      <div className="space-y-2">
        <Label>Patient</Label>
        {isEdit ? (
          <div className="text-sm font-medium">{fixedPatient?.fullName}</div>
        ) : patient ? (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-accent px-2.5 py-1 text-sm font-medium text-accent-foreground">
              {patient.fullName}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPatient(null)}>
              Change
            </Button>
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
            {/* A new invoice lists matches only once something is typed (owner's call,
                2026-10-18) — the recent-patients list pushed the bill below the fold. */}
            {newInvoice && !query.trim() ? null : (
            <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-md border border-border/60">
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
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{p.fullName}</span>
                        {p.mrn ? (
                          <span className="ml-2 text-xs tabular-nums text-muted-foreground">{p.mrn}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{p.phone ?? ""}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Doctor (optional)</Label>
          <SearchableSelect
            ariaLabel="Doctor"
            name="doctorId"
            value={doctorId}
            onChange={(v) => {
              setDoctorId(v);
              void refreshSlots(v, date);
            }}
            options={doctorOptions}
            placeholder="Any doctor"
            className="w-full"
          />
        </div>
        {newInvoice ? (
          <input type="hidden" name="durationMinutes" value={duration} />
        ) : (
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
        )}

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

        {newInvoice ? (
          onLeaveBlock ? (
            <p className="self-end text-sm text-destructive">Doctor is on leave that day. Pick another date.</p>
          ) : null
        ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>{freeTime ? "Time" : "Available times"}</Label>
            {/* Only offered when hours actually constrain the choice: a flexible
                doctor (or "Any doctor") is already free, so the toggle would claim
                to do something it isn't doing. */}
            {doctorId && !selectedDoctor?.flexibleHours ? (
              <label className="flex min-h-6 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={customTime}
                  ref={syncChecked(customTime)}
                  onCheckedChange={setCustomTime} />
                Custom time (outside visiting hours)
              </label>
            ) : null}
          </div>
          {onLeaveBlock ? (
            <p className="text-sm text-destructive">
              Doctor is on leave that day. Pick another date.
            </p>
          ) : freeTime ? (
            <>
              <TimeSelect
                ariaLabel="Appointment time"
                value={effectiveTime || "09:00"}
                onChange={setTime}
              />
              {customTimeUnnecessary ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  This time is within the doctor&apos;s visiting hours, so no exception
                  is needed — it will be saved as a normal appointment.
                </p>
              ) : null}
            </>
          ) : !date ? (
            <p className="text-sm text-muted-foreground">
              Pick a date to see the doctor&apos;s available times.
            </p>
          ) : slots === null ? (
            <p className="text-sm text-muted-foreground">Loading times…</p>
          ) : !slots.available ? (
            <p className="text-sm text-destructive">
              Doctor doesn&apos;t work that day. Pick another date, or tick{" "}
              <strong>Custom time</strong> above to book anyway.
            </p>
          ) : windows.length === 0 ? (
            // Distinguish "doesn't work" from "works, but only on procedures" —
            // the second is fixed by adding a procedure, not by changing the date.
            <p className="text-sm text-destructive">
              {slots.windows.length > 0
                ? "That day is procedure-only. Add a procedure below, or pick another date."
                : "No available times that day."}{" "}
              You can also tick <strong>Custom time</strong> above to book outside the
              doctor&apos;s hours.
            </p>
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
                    <span>
                      {label12(w.start)} – {label12(w.end)}
                    </span>
                    {/* This slot is only in the list because procedures were
                        added — say so, since it appears and disappears. */}
                    {w.kind === "procedure" ? (
                      <span className="ml-auto rounded-md border border-input px-1.5 py-0.5 text-xs text-muted-foreground">
                        Procedure slot
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* Reason: a booking's note. An invoice says what it is for in its lines. */}
        {newInvoice ? null : (
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
        )}

        {/* Consultation fee — its OWN section, separate from procedures. It comes
            from the doctor's set fee (staff → doctor), so it appears the moment a
            doctor is selected. Uncheck to skip it for a procedure-only visit. The
            hidden field always submits the decision (unchecked boxes don't post). */}
        <input
          type="hidden"
          name="chargeConsultation"
          value={chargeConsultation ? "1" : "0"}
        />
        {/* One line (owner's call, 2026-10-18): tick to charge it, the amount beside —
            untick for a procedure-only visit. */}
        {selectedDoctor ? (
          consultationFee > 0 ? (
            <label
              className="flex min-h-9 items-center gap-2 rounded-lg border well px-3 text-sm sm:col-span-2"
              title="Untick if the patient came only for a procedure"
            >
              <Checkbox
                checked={chargeConsultation}
                ref={syncChecked(chargeConsultation)}
                onCheckedChange={setChargeConsultation} />
              Consultation fee
              <span className="ml-auto font-semibold tabular-nums">{formatPkr(consultationFee)}</span>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              This doctor has no consultation fee set (add it under Team).
            </p>
          )
        ) : null}

        {/* Procedures the patient is booked for — priced line items that add to
            the appointment total. Only shown when the clinic has procedures. */}
        {!isEdit && planItems.length > 0 ? (
          <div className="space-y-2 sm:col-span-2 rounded-lg border border-primary/40 bg-accent/30 p-3">
            <Label>From treatment plan</Label>
            <p className="text-xs text-muted-foreground">
              Tick items to schedule onto this visit. They bill like procedures, and bring the plan&apos;s
              discount with them.
            </p>
            {planTerms && "error" in planTerms ? (
              <p className="text-xs text-destructive-text">{planTerms.error}</p>
            ) : null}
            {[...planItemSel].map((id) => (
              <input key={id} type="hidden" name="planItemId" value={id} />
            ))}
            <div className="space-y-1">
              {planItems.map((it) => {
                const checked = planItemSel.has(it.id);
                return (
                  <label key={it.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      ref={syncChecked(checked)}
                      onCheckedChange={() => togglePlanItem(it.id)}
                    />
                    <span>
                      {it.name}
                      {it.tooth ? <span className="text-muted-foreground"> · {it.tooth}</span> : null}
                      <span className="text-muted-foreground"> · {it.planTitle}</span>
                      {it.planDiscount > 0 ? (
                        <span className="text-muted-foreground"> · plan discount {formatPkr(it.planDiscount)}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

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

            {/* Per-procedure quantity + the line total. A line's only discount is the
                clinic offer (shown under its name); the patient's own discount is the
                one below, on the whole bill. */}
            {procSel.size > 0 ? (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
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
                          {line.offer ? (
                            <span className="block text-xs font-normal text-primary-text">
                              {offerLabel(clinicName)} · {describeOfferDiscount(line.offer.type, line.offer.value)}
                            </span>
                          ) : null}
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
                          <span className="w-24 text-right tabular-nums">
                            {line.offer ? (
                              <span className="block text-xs text-muted-foreground line-through">
                                {formatPkr(line.gross)}
                              </span>
                            ) : null}
                            <span className="font-medium">{formatPkr(line.net)}</span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            ) : null}

            {/* One hidden field per procedure: "<id>:<qty>". No discount is sent — the
                server applies the clinic offer itself; the performing doctor is the
                appointment's doctor (set server-side). */}
            {[...procSel.entries()].map(([id, s]) => (
              <input
                key={id}
                type="hidden"
                name="procedure"
                value={`${id}:${s.quantity}`}
              />
            ))}
          </div>
        ) : null}

        {/* Services (room, X-ray, medicines…) and one-off charges — the "Other charges"
            on the bill. No offers and no doctor share; the price can be changed here. */}
        {chargesEnabled || services.length > 0 ? (
          <div className="space-y-2 sm:col-span-2">
            <Label>Services &amp; other charges (optional)</Label>
            {services.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {services.map((p) => {
                  const checked = svcSel.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleSvc(p.id, p.price)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                        checked ? "border-primary bg-primary/10" : "hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex size-4 shrink-0 items-center justify-center rounded border",
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {checked ? <Check className="size-3" aria-hidden="true" /> : null}
                      </span>
                      {p.name} · {formatPkr(p.price)}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {svcSel.size > 0 || charges.length > 0 ? (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                {services
                  .filter((p) => svcSel.has(p.id))
                  .map((p) => {
                    const s = svcSel.get(p.id)!;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{p.name}</span>
                        <div className="flex flex-wrap items-center gap-3">
                          <QuantityStepper
                            label={p.name}
                            value={s.quantity}
                            onChange={(q) => patchSvc(p.id, { quantity: q })}
                          />
                          <PriceInput
                            label={`${p.name} price`}
                            value={s.price}
                            onChange={(v) => patchSvc(p.id, { price: v })}
                          />
                          {(() => {
                            const gross = priceOf(s.price) * s.quantity;
                            const d = lineDiscount(p);
                            const off = d ? computeFee(gross, d.type, d.value).discount : 0;
                            return (
                              <span className="w-28 text-right tabular-nums">
                                {off > 0 ? (
                                  <span className="block text-xs text-muted-foreground line-through">{formatPkr(gross)}</span>
                                ) : null}
                                <span className="font-medium">{formatPkr(gross - off)}</span>
                              </span>
                            );
                          })()}
                        </div>
                      </li>
                    );
                  })}
                {charges.map((c) => (
                  <li key={c.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 text-sm">
                    <Input
                      value={c.name}
                      onChange={(e) => patchCharge(c.key, { name: e.target.value.slice(0, OTHER_CHARGE_NAME_MAX) })}
                      placeholder="e.g. Medicines"
                      aria-label="Charge description"
                      className="h-8 min-w-40 flex-1"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <QuantityStepper
                        label={c.name || "charge"}
                        value={c.quantity}
                        onChange={(q) => (q <= 0 ? removeCharge(c.key) : patchCharge(c.key, { quantity: Math.min(99, q) }))}
                      />
                      <PriceInput
                        label={`${c.name || "Charge"} amount`}
                        value={c.price}
                        onChange={(v) => patchCharge(c.key, { price: v })}
                      />
                      <span className="w-24 text-right font-medium tabular-nums">
                        {formatPkr(priceOf(c.price) * c.quantity)}
                      </span>
                      <button
                        type="button"
                        aria-label="Remove charge"
                        onClick={() => removeCharge(c.key)}
                        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent"
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <Button type="button" variant="outline" size="sm" onClick={addCharge}>
              <Plus className="size-4" aria-hidden="true" /> Add other charge
            </Button>

            {/* "<id>:<qty>:<price>" per service; one JSON field per one-off charge. */}
            {[...svcSel.entries()].map(([id, s]) => (
              <input key={id} type="hidden" name="service" value={`${id}:${s.quantity}:${priceOf(s.price)}`} />
            ))}
            {liveCharges.map((c) => (
              <input
                key={c.key}
                type="hidden"
                name="charge"
                value={JSON.stringify({ n: c.name.trim(), p: priceOf(c.price), q: c.quantity })}
              />
            ))}
          </div>
        ) : null}

        {/* Discount off the whole bill (consultation fee + procedures). Default
            type is Amount (flat PKR); switch to Percent for a % of the total. */}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="discountValue">Discount (optional)</Label>
          <div className="flex gap-2">
            <SelectField
              id="discountType"
              name="discountType"
              value={discountType}
              onValueChange={(next) => setDiscountType(next as DiscountType)}
              options={[
                { value: "amount", label: "Amount (Rs)" },
                { value: "percent", label: "Percent (%)" },
              ]}
              ariaLabel="Discount type"
              className="h-8 w-auto"
            />
            <Input
              id="discountValue"
              name="discountValue"
              type="number"
              inputMode="numeric"
              min={0}
              max={discountType === "percent" ? MAX_DISCOUNT_PERCENT : undefined}
              step={discountType === "percent" ? 1 : 50}
              value={discountValue}
              onChange={(e) => {
                // Digits only; allow empty so the field can be cleared. A percentage
                // is also CLAMPED here: `max` on a number input only constrains the
                // spinner, so 99999 could still be typed — and that value used to
                // reach the database and overflow the SQL bill (ADR-021). Clamping in
                // the field beats a server error after the form is filled in.
                const v = e.target.value.replace(/[^\d]/g, "");
                setDiscountValue(
                  discountType === "percent" && v !== ""
                    ? String(Math.min(Number(v), MAX_DISCOUNT_PERCENT))
                    : v,
                );
              }}
              placeholder={discountType === "percent" ? "e.g. 20" : "e.g. 500"}
            />
          </div>
          {bill.gross > 0 ? (
            (() => {
              const parts: string[] = [];
              if (bill.consultation > 0) parts.push(`${formatPkr(bill.consultation)} fee`);
              const proceduresOnly = bill.proceduresNet - otherChargesTotal;
              if (proceduresOnly > 0) parts.push(`${formatPkr(proceduresOnly)} procedures`);
              if (otherChargesTotal > 0) parts.push(`${formatPkr(otherChargesTotal)} other charges`);
              // Procedures are shown AFTER their clinic offers, so the sum on the left is
              // the SUBTOTAL and only the patient discount comes off it. Subtracting
              // `bill.discount` here (offers included) took each offer off twice.
              const lhs =
                parts.length > 1 ? `${parts.join(" + ")} = ${formatPkr(bill.subtotal)}` : parts[0];
              return (
                <p className="text-sm text-muted-foreground">
                  {lhs}
                  {bill.appointmentDiscount > 0 ? ` − ${formatPkr(bill.appointmentDiscount)} discount` : ""} ={" "}
                  <span className="font-medium text-foreground">{formatPkr(bill.net)}</span>
                </p>
              );
            })()
          ) : selectedDoctor ? (
            <p className="text-sm text-muted-foreground">
              {consultationFee > 0
                ? "Consultation fee not charged and nothing else added."
                : "No consultation fee set and nothing else added."}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Pick a doctor or procedures to see the total.
            </p>
          )}

          {planDiscount ? (
            discountIsPlan ? (
              <p className="text-xs text-muted-foreground">
                From the treatment plan · discount by {discountByLabel(planDiscount.borneBy, planDoctorName, clinicName)}. Agreed
                in the plan, so it needs no approval.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The plan gives {formatPkr(planDiscount.amount)}. A discount changed from the plan&apos;s follows the
                usual approval rules.
              </p>
            )
          ) : null}

          {/* Who absorbs the discount in the doctor/clinic revenue split. Only
              relevant once a discount is entered. Submitted always so an edit that
              clears the discount still records a sane value. */}
          <input type="hidden" name="discountBorneBy" value={borneBy} />
          <input type="hidden" name="discountSplitType" value={splitType} />
          <input type="hidden" name="discountSplitValue" value={borneBy === "split" ? String(splitNumber) : "0"} />
          {discountNumber > 0 ? (
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs text-muted-foreground">Discount borne by</Label>
              <div role="radiogroup" aria-label="Discount borne by" className="flex flex-wrap gap-2">
                {(
                  [
                    ["clinic", "Clinic"],
                    ["doctor", "Doctor"],
                    ["split", "Split"],
                  ] as const
                ).map(([val, label]) => {
                  const checked = borneBy === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => setBorneBy(val)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                        checked ? "border-primary bg-primary/10" : "hover:bg-accent",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Whether the clinic absorbs the discount, it comes off the doctor&apos;s
                share, or it&apos;s split between them. If the bearer requires it, the
                discount waits for approval before it applies.
              </p>

              {/* Split → how much the DOCTOR side bears, with a live preview. */}
              {borneBy === "split" ? (
                (() => {
                  const doctorBorne =
                    splitType === "amount"
                      ? Math.min(splitNumber, bill.appointmentDiscount)
                      : Math.round((bill.appointmentDiscount * splitNumber) / 100);
                  const clinicBorne = Math.max(0, bill.appointmentDiscount - doctorBorne);
                  return (
                    <div className="space-y-1.5 rounded-lg border border-dashed well p-2.5">
                      <Label className="text-xs text-muted-foreground">Doctor bears</Label>
                      <div className="flex gap-2">
                        <SelectField
                          value={splitType}
                          onValueChange={(next) => setSplitType(next as DiscountType)}
                          options={[
                            { value: "percent", label: "Percent (%)" },
                            { value: "amount", label: "Amount (Rs)" },
                          ]}
                          ariaLabel="Doctor's share type"
                          className="h-8 w-auto"
                        />
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={splitType === "percent" ? MAX_DISCOUNT_PERCENT : bill.appointmentDiscount || undefined}
                          step={splitType === "percent" ? 5 : 50}
                          value={splitValue}
                          onChange={(e) => {
                            // Same clamp as the discount field above.
                            const v = e.target.value.replace(/[^\d]/g, "");
                            setSplitValue(
                              splitType === "percent" && v !== ""
                                ? String(Math.min(Number(v), MAX_DISCOUNT_PERCENT))
                                : v,
                            );
                          }}
                          placeholder={splitType === "percent" ? "e.g. 50" : "e.g. 250"}
                          aria-label="Doctor's share of the discount"
                        />
                      </div>
                      {bill.appointmentDiscount > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Of the {formatPkr(bill.appointmentDiscount)} discount: clinic bears{" "}
                          <span className="font-medium text-foreground">{formatPkr(clinicBorne)}</span>, doctor bears{" "}
                          <span className="font-medium text-foreground">{formatPkr(doctorBorne)}</span>.
                        </p>
                      ) : null}
                    </div>
                  );
                })()
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Doctor's hours + remaining capacity for the chosen day. */}
      {slots && slots.available && !newInvoice ? (
        <p className="text-xs text-muted-foreground">
          {slots.flexible
            ? "Flexible: book any time."
            : slots.windows.length
              ? `Working hours ${slots.windows.map((w) => `${w.start}–${w.end}${w.kind === "procedure" ? " (procedures)" : ""}`).join(", ")}.`
              : ""}
          {customTime ? " Custom time on — this visit is booked outside them." : ""}
          {slots.remaining !== null
            ? ` ${slots.remaining} of ${slots.limit} appointment${slots.remaining === 1 ? "" : "s"} left that day.`
            : ""}
        </p>
      ) : null}

      {showPayment ? (
        <div className="space-y-2 rounded-lg border well p-3">
          <p className="text-sm font-medium">
            Payment received{newInvoice ? "" : <span className="font-normal text-muted-foreground"> (optional)</span>}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="inv-pay-amount" className="text-xs text-muted-foreground">
                Amount (Rs)
              </Label>
              <Input
                id="inv-pay-amount"
                name="payAmount"
                type="number"
                inputMode="numeric"
                min={0}
                // Pre-filled with the bill on both forms (owner's call, 2026-10-13); the
                // person changes it for a part payment, or clears it if nothing is paid.
                value={payTouched ? payAmount : bill.net > 0 ? String(bill.net) : ""}
                placeholder="0"
                onChange={(e) => {
                  setPayTouched(true);
                  setPayAmount(e.target.value.replace(/[^\d]/g, ""));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-pay-method" className="text-xs text-muted-foreground">
                Method
              </Label>
              <SelectField
                id="inv-pay-method"
                name="payMethod"
                defaultValue="cash"
                options={methodOptions.map((m) => ({ value: m.value, label: m.label }))}
                ariaLabel="Payment method"
                className="h-9 w-full"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-pay-ref" className="text-xs text-muted-foreground">
                Reference
              </Label>
              <Input id="inv-pay-ref" name="payReference" placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-pay-note" className="text-xs text-muted-foreground">
                Reason (optional)
              </Label>
              <Input id="inv-pay-note" name="payNote" maxLength={500} placeholder="e.g. part payment" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {newInvoice
              ? `Bill ${formatPkr(bill.net)}. Enter 0 if nothing is paid yet; anything above the bill is kept as the patient's advance.`
              : `${bill.net > 0 ? `Bill ${formatPkr(bill.net)}. ` : ""}Set to 0 if nothing is paid now. A payment here confirms the appointment and shows on its invoice.`}
          </p>
        </div>
      ) : null}

      {newInvoice ? (
        // Save opens the invoice; each Save & print <size> opens it AND prints it at
        // that size (core/ui/print-on-arrival). Stuck to the bottom of the screen with
        // the total, so a long bill never means scrolling down to save it.
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-border/70 bg-card/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mr-auto">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-semibold tabular-nums">{formatPkr(bill.net)}</div>
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={pending || !scheduledAt}
            onClick={() => (thenRef.current = "")}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          {printButtons()}
        </div>
      ) : !isEdit && chargesEnabled && printPapers.length > 0 ? (
        // A new appointment can be booked and its invoice printed in one go too.
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="outline"
            disabled={pending || !scheduledAt}
            onClick={() => (thenRef.current = "")}
          >
            {pending ? "Scheduling…" : "Schedule appointment"}
          </Button>
          {printButtons()}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending || !scheduledAt}>
            {pending
              ? isEdit
                ? "Saving…"
                : "Scheduling…"
              : isEdit
                ? invoiceMode
                  ? "Save invoice"
                  : "Save changes"
                : "Schedule appointment"}
          </Button>
        </div>
      )}

      <Dialog
        open={duplicateOpen}
        onOpenChange={(next) => {
          if (!next) setDismissedDuplicate(state);
        }}
        title="This patient already has an appointment that day"
        description={
          state.duplicate
            ? `${state.duplicate.date}: ${state.duplicate.existing.join(", ")}. ${isEdit ? "Move this one to that day anyway?" : newInvoice ? "Create this invoice anyway?" : "Book another one anyway?"}`
            : undefined
        }
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setDismissedDuplicate(state)}>
              {isEdit ? "Don't move" : newInvoice ? "Don't create" : "Don't book"}
            </Button>
            <Button type="button" onClick={bookAnyway} disabled={pending}>
              {isEdit ? "Move anyway" : newInvoice ? "Create invoice anyway" : "Book another"}
            </Button>
          </>
        }
      />

      {/* Failed create/edit → error toast (re-triggered per attempt via nonce). */}
      {/* Edit success → stay on the edit form, show a saved toast (re-triggered per
          save). Create instead redirects to the new appointment's detail page. */}
    </ActionForm>
  );
}

/** − n + for a bill line's quantity. 0 removes the line (the caller decides how). */
function QuantityStepper({ label, value, onChange }: { label: string; value: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Decrease ${label} quantity`}
        onClick={() => onChange(value - 1)}
        className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-accent"
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <span className="w-6 text-center tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={`Increase ${label} quantity`}
        onClick={() => onChange(value + 1)}
        className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-accent"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** A rupee amount typed on the bill — digits only. */
function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">Rs</span>
      <Input
        value={value}
        inputMode="numeric"
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 8))}
        placeholder="0"
        aria-label={label}
        className="h-8 w-24 text-right tabular-nums"
      />
    </div>
  );
}
