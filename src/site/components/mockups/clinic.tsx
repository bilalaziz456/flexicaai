import { AlertTriangle, CalendarClock, ClipboardList, FileText, MessageCircle, Pill as PillIcon, Stethoscope } from "lucide-react";
import { cx } from "../ui";
import { Avatar, MockWindow, Pill, SAMPLE } from "./frame";

/**
 * Clinic-side mockups: the doctor's day, an appointment at the desk and the patient
 * record. Status names are the app's own (scheduled → confirmed → arrived → completed).
 */

const DAY = [
  { time: "09:30", name: "Bilal Ahmed", what: "Follow-up visit", status: "confirmed" },
  { time: "10:30", name: SAMPLE.patient, what: "Sore throat · via WhatsApp", status: "new" },
  { time: "11:15", name: "Hina Raza", what: "Blood pressure review", status: "confirmed" },
  { time: "12:00", name: "Usman Tariq", what: "Check-up", status: "scheduled" },
  { time: "16:00", name: "Fatima Shah", what: "Vaccination", status: "scheduled" },
];

/** The doctor's schedule. Row `[data-new-row]` is the WhatsApp booking; its pill has two states. */
export function ScheduleCard({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <MockWindow
      dark={dark}
      title={`Appointments · ${SAMPLE.doctor}`}
      className={cx("w-full max-w-[400px]", className)}
      right={<span className={cx("text-[11px] font-medium", dark ? "text-slate-400" : "text-ink-mute")}>{SAMPLE.day}</span>}
    >
      <ul className="space-y-1.5">
        {DAY.map((r) => {
          const isNew = r.status === "new";
          return (
            <li
              key={r.time}
              {...(isNew ? { "data-new-row": "" } : {})}
              className={cx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5",
                isNew ? (dark ? "bg-teal/10 ring-1 ring-teal/40" : "bg-teal-soft/60 ring-1 ring-teal/40") : dark ? "bg-white/[0.03]" : "bg-mist/70",
              )}
            >
              <span className={cx("w-11 font-mono text-[12px] tabular-nums", dark ? "text-slate-400" : "text-ink-mute")}>{r.time}</span>
              <div className="min-w-0 flex-1">
                <p className={cx("truncate text-[13px] font-semibold", dark ? "text-white" : "text-ink")}>{r.name}</p>
                <p className={cx("flex items-center gap-1 truncate text-[11.5px]", dark ? "text-slate-400" : "text-ink-mute")}>
                  {isNew && <MessageCircle className="size-3 text-wa" aria-hidden />}
                  {r.what}
                </p>
              </div>
              {isNew ? (
                <span className="relative inline-grid">
                  <span data-status="a" className="col-start-1 row-start-1 opacity-0">
                    <Pill tone="scheduled">Scheduled</Pill>
                  </span>
                  <span data-status="b" className="col-start-1 row-start-1">
                    <Pill tone="confirmed">Confirmed</Pill>
                  </span>
                </span>
              ) : (
                <Pill tone={r.status}>{r.status === "confirmed" ? "Confirmed" : "Scheduled"}</Pill>
              )}
            </li>
          );
        })}
      </ul>
    </MockWindow>
  );
}

/** The appointment at the front desk; `[data-arrive]` swaps Confirmed → Arrived. */
export function ArrivalCard({ className }: { className?: string }) {
  return (
    <MockWindow title="Front desk · Today's queue" className={cx("w-full max-w-[360px]", className)}>
      <div className="flex items-center gap-3">
        <Avatar initials="AK" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">{SAMPLE.patient}</p>
          <p className="text-[12px] text-ink-mute">
            MRN {SAMPLE.mrn} · Token #7
          </p>
        </div>
        <span className="relative inline-grid">
          <span data-arrive="a" className="col-start-1 row-start-1 opacity-0">
            <Pill tone="confirmed">Confirmed</Pill>
          </span>
          <span data-arrive="b" className="col-start-1 row-start-1">
            <Pill tone="arrived">Arrived</Pill>
          </span>
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-lg bg-mist/80 px-3 py-2">
          <dt className="text-ink-mute">Time</dt>
          <dd className="font-semibold text-ink">10:30 am</dd>
        </div>
        <div className="rounded-lg bg-mist/80 px-3 py-2">
          <dt className="text-ink-mute">Doctor</dt>
          <dd className="font-semibold text-ink">{SAMPLE.doctor}</dd>
        </div>
      </dl>
      <div className="mt-3 flex gap-2" aria-hidden>
        <span className="flex-1 rounded-lg bg-navy-800 py-2 text-center text-[12px] font-semibold text-white">Mark arrived</span>
        <span className="flex-1 rounded-lg border border-mist-300 py-2 text-center text-[12px] font-semibold text-ink-soft">Open record</span>
      </div>
    </MockWindow>
  );
}

/** The patient record a doctor opens: profile, alerts, history, last visits, plan. */
export function PatientRecord({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <MockWindow title={`Patients · ${SAMPLE.patient}`} className={cx("w-full max-w-[440px]", className)}>
      <div className="flex items-center gap-3">
        <Avatar initials="AK" size="lg" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">{SAMPLE.patient}</p>
          <p className="text-[12px] text-ink-mute">F · 34 yrs · MRN {SAMPLE.mrn}</p>
        </div>
      </div>

      <div data-rec="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">Medical history:</strong> allergic to penicillin · mild asthma
        </span>
      </div>

      <div data-rec="visits" className="mt-4">
        <p className="eyebrow !text-[10px] !tracking-[0.16em] text-ink-mute">Previous visits</p>
        <ul className="mt-2 space-y-1.5 text-[12.5px]">
          {[
            { d: "02 Sep", t: "General check-up", who: "Dr. Sana Malik" },
            { d: "18 Mar", t: "Asthma review", who: "Dr. Omar Rafiq" },
          ].map((v) => (
            <li key={v.d} className="flex items-center gap-2.5 rounded-lg bg-mist/80 px-3 py-2">
              <Stethoscope className="size-3.5 text-teal-ink" aria-hidden />
              <span className="font-mono text-[11px] text-ink-mute">{v.d}</span>
              <span className="flex-1 truncate font-medium text-ink">{v.t}</span>
              {!compact && <span className="hidden text-[11px] text-ink-mute sm:inline">{v.who}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div data-rec="plan" className="mt-4">
        <p className="eyebrow !text-[10px] !tracking-[0.16em] text-ink-mute">Treatment plan</p>
        <ul className="mt-2 divide-y divide-mist-200 rounded-xl ring-1 ring-mist-200">
          {[
            { t: "CBC lab test", s: "Planned", tone: "scheduled" },
            { t: "Follow-up consultation", s: "Planned", tone: "scheduled" },
            { t: "Consultation", s: "Done", tone: "completed" },
          ].map((p) => (
            <li key={p.t} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
              <ClipboardList className="size-3.5 text-ink-mute" aria-hidden />
              <span className="flex-1 truncate text-ink">{p.t}</span>
              <Pill tone={p.tone}>{p.s}</Pill>
            </li>
          ))}
        </ul>
      </div>

      {!compact && (
        <div data-rec="docs" className="mt-4 flex flex-wrap gap-2 text-[11.5px]">
          {[
            { I: FileText, t: "Clinical notes" },
            { I: PillIcon, t: "Prescriptions" },
            { I: CalendarClock, t: "Appointments" },
          ].map(({ I, t }) => (
            <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-mist px-2.5 py-1 font-medium text-ink-soft ring-1 ring-mist-200">
              <I className="size-3.5" aria-hidden />
              {t}
            </span>
          ))}
        </div>
      )}
    </MockWindow>
  );
}
