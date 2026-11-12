import { BellRing, Check, FileText, History, Lock, Printer, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { cx } from "../ui";
import { PatientRecord, ScheduleCard } from "./clinic";
import { Avatar, MockWindow, Pill, SAMPLE } from "./frame";

/** Small product visuals for the feature showcase and the feature pages. */

export function InvoiceMock({ className }: { className?: string }) {
  const lines = [
    { k: "Consultation", d: SAMPLE.doctor, v: 2500, disc: 0 },
    { k: "Minor procedure · wound suturing", d: "Procedure", v: 18000, disc: 1800 },
    { k: "ECG", d: "Service", v: 800, disc: 0 },
  ];
  const sub = lines.reduce((s, l) => s + l.v, 0);
  const disc = lines.reduce((s, l) => s + l.disc, 0);
  const total = sub - disc;
  const paid = 12000;
  const n = (v: number) => v.toLocaleString("en-US");
  return (
    <MockWindow title="Invoice INV-02418" className={cx("w-full max-w-[440px]", className)} right={<Pill tone="draft">Partly paid</Pill>}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[14px] font-semibold text-ink">{SAMPLE.patient}</p>
          <p className="text-[11.5px] text-ink-mute">MRN {SAMPLE.mrn} · {SAMPLE.day}</p>
        </div>
        <p className="text-right text-[11px] text-ink-mute">{SAMPLE.clinic}</p>
      </div>
      <table className="mt-4 w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-ink-mute">
            <th className="pb-2 font-medium">Item</th>
            <th className="pb-2 text-right font-medium">Rs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-mist-200">
          {lines.map((l) => (
            <tr key={l.k}>
              <td className="py-2">
                <p className="font-medium text-ink">{l.k}</p>
                <p className="text-[11px] text-ink-mute">
                  {l.d}
                  {l.disc > 0 && <span className="text-teal-ink"> · line discount −{n(l.disc)}</span>}
                </p>
              </td>
              <td className="py-2 text-right tabular-nums text-ink">{n(l.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 space-y-1 border-t border-mist-200 pt-3 text-[12px]">
        <div className="flex justify-between text-ink-mute">
          <dt>Discounts</dt>
          <dd className="tabular-nums">−{n(disc)}</dd>
        </div>
        <div className="flex justify-between font-semibold text-ink">
          <dt>Total</dt>
          <dd className="tabular-nums">{n(total)}</dd>
        </div>
        <div className="flex justify-between text-ink-mute">
          <dt>Paid · cash</dt>
          <dd className="tabular-nums">{n(paid)}</dd>
        </div>
        <div className="flex justify-between font-semibold text-rose-700">
          <dt>Balance due</dt>
          <dd className="tabular-nums">{n(total - paid)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-medium text-ink-soft" aria-hidden>
        {["Thermal", "A5", "A4"].map((p) => (
          <span key={p} className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 ring-1 ring-mist-200">
            <Printer className="size-3" /> {p}
          </span>
        ))}
      </div>
    </MockWindow>
  );
}

function DoctorScheduleMock() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const docs = [
    { n: "Dr. Sana Malik", hours: ["10–6", "10–6", "10–6", "10–6", "10–6", "10–2"], cap: 16 },
    { n: "Dr. Omar Rafiq", hours: ["2–8", "2–8", "Leave", "2–8", "2–8", "—"], cap: 12 },
    { n: "Dr. Hira Aslam", hours: ["—", "11–5", "11–5", "—", "11–5", "11–5"], cap: 10 },
  ];
  return (
    <MockWindow title="Doctor schedule · This week" className="w-full max-w-[460px]">
      <div className="grid grid-cols-[6.5rem_repeat(6,minmax(0,1fr))] gap-1 text-[10.5px]">
        <span />
        {days.map((d) => (
          <span key={d} className="pb-1 text-center font-medium text-ink-mute">
            {d}
          </span>
        ))}
        {docs.map((d) => (
          <Row key={d.n} d={d} />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-ink-mute">Daily caps and leave are checked on every booking — including WhatsApp.</p>
    </MockWindow>
  );
}

function Row({ d }: { d: { n: string; hours: string[]; cap: number } }) {
  return (
    <>
      <span className="truncate py-1.5 pr-1 text-[11.5px] font-medium text-ink">
        {d.n.replace("Dr. ", "Dr ")}
        <span className="block text-[10px] font-normal text-ink-mute">cap {d.cap}/day</span>
      </span>
      {d.hours.map((h, i) => (
        <span
          key={i}
          className={cx(
            "grid place-items-center rounded-md py-1.5 text-center",
            h === "Leave" ? "bg-rose-50 text-rose-700" : h === "—" ? "bg-mist/60 text-ink-mute/60" : "bg-teal-soft/70 font-medium text-teal-ink",
          )}
        >
          {h}
        </span>
      ))}
    </>
  );
}

function MedicalHistoryMock() {
  return (
    <MockWindow title={`Medical history · ${SAMPLE.patient}`} className="w-full max-w-[420px]">
      <ul className="space-y-2 text-[12.5px]">
        {[
          { k: "Allergies", v: "Penicillin", warn: true },
          { k: "Conditions", v: "Mild asthma" },
          { k: "Current medicines", v: "Salbutamol inhaler, as needed" },
          { k: "Attachments", v: "2 files" },
        ].map((r) => (
          <li key={r.k} className={cx("flex justify-between gap-4 rounded-lg px-3 py-2", r.warn ? "bg-amber-50 ring-1 ring-amber-200" : "bg-mist/80")}>
            <span className="text-ink-mute">{r.k}</span>
            <span className={cx("text-right font-medium", r.warn ? "text-amber-900" : "text-ink")}>{r.v}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <p className="eyebrow !text-[10px] !tracking-[0.16em] text-ink-mute">Attachments</p>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-[11.5px]">
          {[
            { t: "Chest X-ray", d: "02 Sep" },
            { t: "CBC report", d: "18 Mar" },
          ].map((f) => (
            <li key={f.t} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-mist-200">
              <FileText className="size-3.5 shrink-0 text-teal-ink" aria-hidden />
              <span className="flex-1 truncate font-medium text-ink">{f.t}</span>
              <span className="font-mono text-[10px] text-ink-mute">{f.d}</span>
            </li>
          ))}
        </ul>
      </div>
    </MockWindow>
  );
}

function TreatmentPlanMock() {
  return (
    <MockWindow title="Treatment plan & estimate" className="w-full max-w-[420px]" right={<Pill tone="scheduled">Proposed</Pill>}>
      <ul className="divide-y divide-mist-200 text-[12.5px]">
        {[
          { t: "Minor surgery · cyst excision", v: "18,000" },
          { t: "Physiotherapy · 6 sessions", v: "22,000" },
          { t: "Follow-up consultations · 3", v: "4,500" },
        ].map((r) => (
          <li key={r.t} className="flex justify-between py-2">
            <span className="text-ink">{r.t}</span>
            <span className="tabular-nums text-ink">Rs {r.v}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-2 space-y-1 border-t border-mist-200 pt-2 text-[12px]">
        <div className="flex justify-between text-teal-ink">
          <dt>Plan discount</dt>
          <dd className="tabular-nums">− Rs 2,500</dd>
        </div>
        <div className="flex justify-between font-semibold text-ink">
          <dt>Estimate</dt>
          <dd className="tabular-nums">Rs 42,000</dd>
        </div>
      </dl>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-mute">
        <FileText className="size-3.5" aria-hidden /> Prints on the clinic letterhead
      </p>
    </MockWindow>
  );
}

function PrescriptionMock() {
  return (
    <MockWindow title="Prescription · A4 letterhead" className="w-full max-w-[400px]">
      <div className="rounded-xl border border-mist-200 bg-white p-4">
        <div className="flex items-center justify-between border-b border-mist-200 pb-2">
          <p className="text-[13px] font-semibold text-navy-800">{SAMPLE.clinic}</p>
          <p className="text-[10.5px] text-ink-mute">{SAMPLE.day}</p>
        </div>
        <p className="mt-2 text-[11.5px] text-ink-mute">
          {SAMPLE.patient} · {SAMPLE.mrn}
        </p>
        <p className="mt-3 font-serif text-xl italic text-navy-800">Rx</p>
        <ol className="mt-1 space-y-1.5 text-[12.5px] text-ink">
          <li>1. Azithromycin 500 mg — 1 tab once daily × 3 days</li>
          <li>2. Paracetamol 500 mg — 1 tab when needed for fever</li>
        </ol>
        <p className="mt-4 text-right text-[11px] text-ink-mute">{SAMPLE.doctor}</p>
      </div>
      <p className="mt-3 text-[11px] text-ink-mute">An approved scribe note&apos;s medicines become a prescription.</p>
    </MockWindow>
  );
}

function SalesMock() {
  const rows = [
    { k: "Minor procedures", n: 21, v: "378,000" },
    { k: "Lab tests", n: 48, v: "216,000" },
    { k: "Day-care procedures", n: 9, v: "198,000" },
    { k: "Consultations", n: 132, v: "330,000" },
  ];
  return (
    <MockWindow title="Sales · November" className="w-full max-w-[440px]">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-ink-mute">
            <th className="pb-2 font-medium">Procedure</th>
            <th className="pb-2 text-right font-medium">Count</th>
            <th className="pb-2 text-right font-medium">Rs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-mist-200">
          {rows.map((r) => (
            <tr key={r.k}>
              <td className="py-2 text-ink">{r.k}</td>
              <td className="py-2 text-right tabular-nums text-ink-mute">{r.n}</td>
              <td className="py-2 text-right font-medium tabular-nums text-ink">{r.v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-ink-mute">Every report downloads as a PDF.</p>
    </MockWindow>
  );
}

function StaffMock() {
  const team = [
    { i: "SM", n: "Dr. Sana Malik", r: "Clinic admin · Doctor" },
    { i: "OR", n: "Dr. Omar Rafiq", r: "Doctor" },
    { i: "NB", n: "Nadia Baig", r: "Receptionist" },
    { i: "KJ", n: "Kamran Javed", r: "Manager" },
  ];
  return (
    <MockWindow title="Team" className="w-full max-w-[420px]">
      <ul className="space-y-1.5">
        {team.map((t) => (
          <li key={t.n} className="flex items-center gap-3 rounded-xl bg-mist/80 px-3 py-2">
            <Avatar initials={t.i} size="sm" tone="navy" />
            <span className="flex-1 text-[12.5px] font-semibold text-ink">{t.n}</span>
            <span className="text-[11px] text-ink-mute">{t.r}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-mute">
        <Users className="size-3.5" aria-hidden /> One login per person — never a shared account.
      </p>
    </MockWindow>
  );
}

function AnalyticsMock() {
  const bars = [62, 71, 68, 80, 77, 88];
  return (
    <MockWindow title="Reports · Appointments" className="w-full max-w-[440px]">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { k: "Appointments", v: "412" },
          { k: "Completed", v: "371" },
          { k: "No-shows", v: "19" },
        ].map((s) => (
          <div key={s.k} className="rounded-xl bg-mist/80 px-2 py-2.5">
            <p className="text-[10.5px] text-ink-mute">{s.k}</p>
            <p className="text-[17px] font-semibold tabular-nums text-ink">{s.v}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-24 items-end gap-2" aria-hidden>
        {bars.map((b, i) => (
          <span key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-navy-700 to-teal" style={{ height: `${b}%` }} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-mute">Appointments, procedures, daybook and no-shows.</p>
    </MockWindow>
  );
}

function RecallMock() {
  const rows = [
    { n: "Usman Tariq", r: "6-month check-up", d: "Due today", tone: "due" },
    { n: "Hina Raza", r: "Blood pressure review", d: "Sent on WhatsApp", tone: "confirmed" },
    { n: "Bilal Ahmed", r: "Follow-up visit", d: "Booked", tone: "arrived" },
  ];
  return (
    <MockWindow title="Recalls" className="w-full max-w-[420px]">
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.n} className="flex items-center gap-3 rounded-xl bg-mist/80 px-3 py-2">
            <BellRing className="size-3.5 text-teal-ink" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-ink">{r.n}</p>
              <p className="text-[11px] text-ink-mute">{r.r}</p>
            </div>
            <Pill tone={r.tone}>{r.d}</Pill>
          </li>
        ))}
      </ul>
    </MockWindow>
  );
}

function PermissionsMock() {
  const caps = ["Appointments", "Patients", "Clinical notes", "Billing", "Profit & loss"];
  const roles = [
    { r: "Receptionist", on: [true, true, false, true, false] },
    { r: "Doctor", on: [true, true, true, false, false] },
    { r: "Manager", on: [true, true, false, true, true] },
  ];
  return (
    <MockWindow title="Permissions" className="w-full max-w-[460px]">
      <div className="grid grid-cols-[6.5rem_repeat(3,minmax(0,1fr))] gap-1 text-[11px]">
        <span />
        {roles.map((r) => (
          <span key={r.r} className="pb-1 text-center font-medium text-ink-mute">
            {r.r}
          </span>
        ))}
        {caps.map((c, ci) => (
          <PermRow key={c} c={c} values={roles.map((r) => r.on[ci])} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-mute">
        <span className="flex items-center gap-1.5">
          <History className="size-3.5" aria-hidden /> Activity log
        </span>
        <span className="flex items-center gap-1.5">
          <RotateCcw className="size-3.5" aria-hidden /> Restorable trash
        </span>
      </div>
    </MockWindow>
  );
}

function PermRow({ c, values }: { c: string; values: boolean[] }) {
  return (
    <>
      <span className="py-1.5 text-[11.5px] font-medium text-ink">{c}</span>
      {values.map((v, i) => (
        <span key={i} className={cx("grid place-items-center rounded-md py-1.5", v ? "bg-teal-soft/70 text-teal-ink" : "bg-mist/60 text-ink-mute/60")}>
          {v ? <Check className="size-3.5" aria-label="Allowed" /> : <Lock className="size-3" aria-label="Not allowed" />}
        </span>
      ))}
    </>
  );
}

function PaymentsMock() {
  return (
    <MockWindow title="Payments · Today" className="w-full max-w-[420px]">
      <ul className="space-y-1.5 text-[12.5px]">
        {[
          { n: SAMPLE.patient, m: "Cash", v: "12,000" },
          { n: "Bilal Ahmed", m: "Cheque", v: "4,500" },
          { n: "Hina Raza", m: "Bank transfer", v: "9,000" },
          { n: "Fatima Shah", m: "Deposit held", v: "5,000" },
        ].map((r) => (
          <li key={r.n} className="flex items-center gap-3 rounded-xl bg-mist/80 px-3 py-2">
            <span className="flex-1 font-medium text-ink">{r.n}</span>
            <span className="text-[11px] text-ink-mute">{r.m}</span>
            <span className="w-16 text-right font-semibold tabular-nums text-ink">{r.v}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-mute">
        <ShieldCheck className="size-3.5" aria-hidden /> Petty cash is reconciled at each handover.
      </p>
    </MockWindow>
  );
}

export type ShowcaseKey =
  | "patients"
  | "appointments"
  | "doctor-schedule"
  | "medical-history"
  | "treatment-plans"
  | "prescriptions"
  | "billing"
  | "sales"
  | "staff"
  | "analytics"
  | "recalls"
  | "permissions"
  | "payments";

export function ShowcaseVisual({ k }: { k: ShowcaseKey }) {
  switch (k) {
    case "patients":
      return <PatientRecord compact />;
    case "appointments":
      return <ScheduleCard />;
    case "doctor-schedule":
      return <DoctorScheduleMock />;
    case "medical-history":
      return <MedicalHistoryMock />;
    case "treatment-plans":
      return <TreatmentPlanMock />;
    case "prescriptions":
      return <PrescriptionMock />;
    case "billing":
      return <InvoiceMock />;
    case "sales":
      return <SalesMock />;
    case "staff":
      return <StaffMock />;
    case "analytics":
      return <AnalyticsMock />;
    case "recalls":
      return <RecallMock />;
    case "permissions":
      return <PermissionsMock />;
    case "payments":
      return <PaymentsMock />;
  }
}
