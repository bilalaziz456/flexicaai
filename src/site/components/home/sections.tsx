import { FAQ } from "../../lib/site";
import { Ambient } from "../site/rich";
import { ButtonLink, Container, Eyebrow, SectionHeading } from "../ui";
import { WhyFlip } from "./why-flip";
import { FaqAccordion } from "./faq-accordion";
import { WHATSAPP_URL } from "../../lib/contact";
import { WhatsAppIcon } from "../contact/whatsapp-icon";

const CORE = ["Patients", "Appointments", "WhatsApp", "AI scribe engine", "Billing", "Finance & P&L", "Permissions", "Activity log"];

/** "Built for today, ready for tomorrow" — one shared core, and the people who use it. */
export function PlatformSection() {
  return (
    <section aria-labelledby="platform-title" className="relative overflow-hidden bg-white py-24 lg:py-32">
      <Container>
        <div className="grid gap-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
          <div>
            <SectionHeading
              id="platform-title"
              eyebrow="Platform architecture"
              title="Built for Today. Ready for Tomorrow."
              lead="FlexicaAI is one shared core — patients, scheduling, WhatsApp, the AI scribe engine, billing, finance and permissions — that the whole clinic works from."
            />
            <dl className="mt-10 space-y-5">
              <div className="flex gap-4">
                <span className="mt-1 size-3 shrink-0 rounded-full bg-teal ring-4 ring-teal/20" aria-hidden />
                <div>
                  <dt className="font-semibold text-ink">One system, not a stack of tools</dt>
                  <dd className="mt-1 text-[0.95rem] leading-relaxed text-ink-soft">
                    A booking on WhatsApp, the visit, the doctor&apos;s note, the bill and the month&apos;s P&amp;L are the same
                    record moving forward — nothing is copied between apps.
                  </dd>
                </div>
              </div>
              <div className="flex gap-4">
                <span className="mt-1 size-3 shrink-0 rounded-full bg-teal ring-4 ring-teal/20" aria-hidden />
                <div>
                  <dt className="font-semibold text-ink">Set up around your clinic</dt>
                  <dd className="mt-1 text-[0.95rem] leading-relaxed text-ink-soft">
                    Your doctors, their working hours and daily limits, your services and fees, your printers and your
                    letterhead.
                  </dd>
                </div>
              </div>
            </dl>
          </div>

          <figure className="relative">
            <div className="absolute inset-0 rounded-[2rem] bg-mist grid-dots" aria-hidden />
            <svg
              viewBox="0 0 640 520"
              className="relative h-auto w-full"
              role="img"
              aria-labelledby="platform-diagram-title"
            >
              <title id="platform-diagram-title">
                Diagram: the FlexicaAI core — patients, appointments, WhatsApp, AI scribe, billing, finance, permissions and
                activity log — shared by the front desk, the doctors and the clinic owner.
              </title>
              <defs>
                <linearGradient id="core-g" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#0b3d6b" />
                  <stop offset="1" stopColor="#04152e" />
                </linearGradient>
              </defs>
              {/* Connectors */}
              {[140, 320, 500].map((x) => (
                <path
                  key={x}
                  d={`M320 250 C 320 330, ${x} 340, ${x} 410`}
                  fill="none"
                  stroke="#0fb4bb"
                  strokeWidth="2.5"
                  strokeDasharray="6 8"
                  className="motion-safe:animate-[dash_2s_linear_infinite]"
                />
              ))}

              {/* Core */}
              <rect x="110" y="40" width="420" height="210" rx="28" fill="url(#core-g)" />
              <text x="320" y="82" textAnchor="middle" className="fill-[#5fe0e4] font-mono text-[12px] tracking-[0.2em]">
                FLEXICAAI CORE
              </text>
              {CORE.map((c, i) => {
                const col = i % 4;
                const row = Math.floor(i / 4);
                const x = 136 + col * 96;
                const y = 108 + row * 62;
                return (
                  <g key={c}>
                    <rect x={x} y={y} width="88" height="48" rx="12" fill="rgb(255 255 255 / 0.07)" stroke="rgb(255 255 255 / 0.12)" />
                    <text x={x + 44} y={y + 29} textAnchor="middle" className="fill-white text-[11px] font-medium">
                      {c.length > 13 ? c.split(" ").slice(0, 2).join(" ") : c}
                    </text>
                  </g>
                );
              })}

              {/* The people who work from it */}
              {[
                { x: 60, t: "Front desk", d: "Bookings, arrivals, bills" },
                { x: 240, t: "Doctors", d: "Records, notes, plans" },
                { x: 420, t: "Owner", d: "Sales, expenses, P&L" },
              ].map((m) => (
                <g key={m.t}>
                  <rect x={m.x} y="410" width="160" height="72" rx="18" fill="#0fb4bb" />
                  <text x={m.x + 80} y="442" textAnchor="middle" className="fill-[#04152e] text-[15px] font-semibold">
                    {m.t}
                  </text>
                  <text x={m.x + 80} y="463" textAnchor="middle" className="fill-[#04152e] text-[11px]">
                    {m.d}
                  </text>
                </g>
              ))}
            </svg>
          </figure>
        </div>
      </Container>
    </section>
  );
}

const WHY = [
  { before: "Patient details split across registers, phones and spreadsheets", after: "Connected patient management: one record per patient, everything on it" },
  { before: "Bookings by phone call, written in a diary", after: "Simplified appointment workflows, from the desk or by WhatsApp" },
  { before: "Reminders sent by hand — when someone remembers", after: "WhatsApp confirmations, reminders and recalls that go out on their own" },
  { before: "Notes typed after hours, or not at all", after: "AI-assisted clinical documentation the doctor reviews and approves" },
  { before: "History that lives in a doctor's memory", after: "Structured patient records: allergies, visits, plans, X-rays" },
  { before: "Bills in one book, payments in another", after: "Integrated clinic billing: invoices, receipts, deposits and balances" },
  { before: "Month-end guesswork about what the clinic earned", after: "Financial visibility: sales, expenses, shares and profit and loss" },
  { before: "Shared logins and no record of who changed what", after: "Organised operations: personal logins, permissions and an activity log" },
];

export function WhySection() {
  return (
    <section aria-labelledby="why-title" className="relative overflow-hidden bg-mist py-24 lg:py-32">
      <Ambient />
      <Container className="relative">
        <SectionHeading
          id="why-title"
          align="center"
          eyebrow="Why FlexicaAI"
          title="Less Administrative Work. More Time for What Matters."
          lead="What changes when the whole clinic works from one connected system."
        />
        <WhyFlip rows={WHY} />
      </Container>
    </section>
  );
}

/** Every answer is in the HTML (FaqAccordion clips closed ones, never removes them). */
export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="relative overflow-hidden bg-white py-24 lg:py-32">
      <Ambient />
      <Container className="relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <Eyebrow>Questions</Eyebrow>
            <h2 id="faq-title" className="text-h2 mt-5 text-ink">
              What clinics ask us first.
            </h2>
            <p className="text-lead mt-5 text-ink-soft">Straight answers about how FlexicaAI works today.</p>

            {/* Still have a question? */}
            <div className="band-dark grain relative mt-10 overflow-hidden rounded-[1.75rem] p-7" data-reveal>
              <div className="orb -right-16 -top-16 size-56 bg-teal/30" aria-hidden />
              <div className="relative flex items-center gap-3">
                <span className="relative grid size-11 place-items-center rounded-full bg-wa text-white">
                  <WhatsAppIcon className="size-6" />
                  <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-teal-glow ring-2 ring-navy-900 motion-safe:animate-pulse" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold text-white">Still have a question?</p>
                  <p className="text-[13px] text-slate-400">Ask our team on WhatsApp.</p>
                </div>
              </div>
              <div className="relative mt-6 space-y-2.5" aria-hidden>
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md bg-[#d9fdd3] px-4 py-2.5 text-[13px] text-[#111b21] shadow-sm">
                  Hi, I have a question about FlexicaAI for our clinic.
                </div>
                <div className="flex w-fit items-center gap-1.5 rounded-2xl rounded-tl-md bg-white/10 px-4 py-3">
                  <span className="typing-dot size-1.5 rounded-full bg-teal-glow" />
                  <span className="typing-dot size-1.5 rounded-full bg-teal-glow" />
                  <span className="typing-dot size-1.5 rounded-full bg-teal-glow" />
                </div>
              </div>
              <div className="relative mt-6">
                <ButtonLink href={WHATSAPP_URL} external>
                  Message us on WhatsApp
                </ButtonLink>
              </div>
            </div>
          </div>
          <FaqAccordion faqs={FAQ} />
        </div>
      </Container>
    </section>
  );
}
