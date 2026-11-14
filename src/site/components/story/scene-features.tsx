"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  BellRing,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  HeartPulse,
  Pill,
  Receipt,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { ShowcaseVisual, type ShowcaseKey } from "../mockups/showcase";

import { Container, SampleTag, SectionHeading, cx } from "../ui";
import { useOnScreen } from "./webgl";

const FEATURES: { k: ShowcaseKey; I: LucideIcon; t: string; d: string; href?: string }[] = [
  {
    k: "patients",
    I: Users,
    t: "Patient management",
    d: "One record per patient with a permanent MRN: contact details, visits, notes, attachments, bills and balance.",
    href: "/features/patient-management",
  },
  {
    k: "appointments",
    I: CalendarDays,
    t: "Appointment scheduling",
    d: "Book in seconds, see who is confirmed, who has arrived and who is with the doctor — from the desk or WhatsApp.",
    href: "/features/appointment-management",
  },
  {
    k: "doctor-schedule",
    I: CalendarClock,
    t: "Doctor scheduling",
    d: "Working hours per weekday, a daily appointment limit and leave that blocks new bookings automatically.",
  },
  {
    k: "medical-history",
    I: HeartPulse,
    t: "Patient medical history",
    d: "Allergies, conditions and current medicines up front, with X-rays and documents attached to the record.",
  },
  {
    k: "treatment-plans",
    I: ClipboardList,
    t: "Treatment plans",
    d: "Multi-visit plans with estimates and plan discounts, printed on your clinic's letterhead for the patient.",
  },
  {
    k: "prescriptions",
    I: Pill,
    t: "Prescriptions",
    d: "Typed or carried over from an approved scribe note, printed on A4 letterhead or on your pre-printed pad.",
  },
  {
    k: "billing",
    I: Receipt,
    t: "Billing and payments",
    d: "Invoices with per-line discounts, deposits and receipts. Prints on thermal, A5 or A4 — whatever the desk has.",
    href: "/features/billing-and-payments",
  },
  {
    k: "sales",
    I: TrendingUp,
    t: "Sales reports",
    d: "Realised revenue by procedure, doctor and day, with receivables and discounts on their own pages.",
    href: "/features/clinic-analytics",
  },
  {
    k: "staff",
    I: UserCog,
    t: "Staff management",
    d: "Doctors, receptionists and managers each get their own login — so every action has a name against it.",
  },
  {
    k: "analytics",
    I: BarChart3,
    t: "Clinic analytics",
    d: "Appointment, procedure and daybook reports, no-shows and profit and loss, each downloadable as a PDF.",
    href: "/features/clinic-analytics",
  },
  {
    k: "recalls",
    I: BellRing,
    t: "Recall management",
    d: "Check-ups and follow-ups fall due on their own and go out on WhatsApp, so returning patients aren't forgotten.",
  },
  {
    k: "permissions",
    I: ShieldCheck,
    t: "Role-based permissions",
    d: "Grant each person exactly what their job needs. An activity log records who did what; deleted items can be restored.",
  },
];

/** The two features shown with their full product screen; the rest are cards. */
const SHOWCASED: ShowcaseKey[] = ["patients", "billing"];

/**
 * SCENE 6 — everything else the clinic needs: two showcased features with their whole
 * product screen, then the other ten as compact cards.
 *
 * History (owner, 2026-11-15): a scroll story and a tab switcher left "too much empty
 * space"; a bento grid then CUT text and lists, because the product screens are drawn
 * for ~400px and a quarter-width tile is ~230px. The rule now: a product screen only
 * appears where it has room to be shown whole, and no text is ever clamped. The only
 * motion is a staggered fade-up as the section arrives and a lift on hover.
 */
export function SceneFeatures() {
  const root = useRef<HTMLDivElement>(null);
  const shown = useOnScreen(root, "-10% 0px");
  const big = FEATURES.filter((f) => SHOWCASED.includes(f.k));
  const rest = FEATURES.filter((f) => !SHOWCASED.includes(f.k));
  const rise = (i: number) => ({
    className: cx("transition-all duration-700 ease-[var(--ease-out-expo)]", shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"),
    style: { transitionDelay: shown ? `${i * 50}ms` : "0ms" },
  });

  return (
    <section id="platform" aria-labelledby="scene-features-title" className="relative overflow-x-clip bg-white pb-16 pt-20 lg:pb-20 lg:pt-28">
      <Container>
        <SectionHeading
          id="scene-features-title"
          eyebrow="The features"
          title="Everything Your Clinic Needs. One Connected Workspace."
          lead="Appointments, patient records, WhatsApp, the AI scribe, billing and reports — built in, not bolted on, for the front desk, the doctors and the owner."
        />

        <div ref={root} className="mt-12 grid gap-4 lg:mt-16">
          {/* Showcased: the product screen, whole */}
          <div className="grid gap-4 lg:grid-cols-2">
            {big.map((f, i) => {
              const r = rise(i);
              const inner = (
                <>
                  <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-teal/25 blur-3xl" />
                  <span aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 size-72 rounded-full bg-blue/20 blur-3xl" />
                  <span aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:20px_20px]" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-teal-glow ring-1 ring-white/15">
                        <f.I className="size-5" aria-hidden />
                      </span>
                      <h3 className="text-[1.3rem] font-semibold tracking-[-0.01em] text-white">{f.t}</h3>
                    </div>
                    {f.href && (
                      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-transform duration-300 group-hover:rotate-45">
                        <ArrowUpRight className="size-4" />
                      </span>
                    )}
                  </div>
                  <p className="relative mt-3 max-w-lg text-[0.95rem] leading-relaxed text-slate-300">{f.d}</p>
                  <div aria-hidden className="relative mx-auto mt-6 w-full max-w-[500px] transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:-translate-y-1">
                    <ShowcaseVisual k={f.k} />
                  </div>
                </>
              );
              const cls = cx(
                "group relative flex flex-col overflow-hidden rounded-[1.75rem] bg-navy-900 p-6 shadow-[0_30px_70px_-30px_rgba(4,21,46,0.7)] ring-1 ring-navy-700 sm:p-8",
                r.className,
              );
              return f.href ? (
                <Link key={f.k} href={f.href} className={cls} style={r.style} aria-label={`${f.t} — learn more`}>
                  {inner}
                </Link>
              ) : (
                <article key={f.k} className={cls} style={r.style}>
                  {inner}
                </article>
              );
            })}
          </div>

          {/* Everything else: full text, no pictures to squeeze */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {rest.map((f, i) => {
              const r = rise(i + 2);
              const inner = (
                <>
                  <div className="flex items-start justify-between">
                    <span className="grid size-10 place-items-center rounded-xl bg-white text-teal-ink shadow-sm ring-1 ring-mist-200 transition-colors duration-300 group-hover:bg-navy-800 group-hover:text-teal-glow">
                      <f.I className="size-5" aria-hidden />
                    </span>
                    {f.href && <ArrowUpRight aria-hidden className="size-4 text-ink-mute transition-all duration-300 group-hover:rotate-45 group-hover:text-teal-ink" />}
                  </div>
                  <h3 className="mt-4 text-[1rem] font-semibold leading-snug text-ink">{f.t}</h3>
                  <p className="mt-1.5 text-[0.86rem] leading-relaxed text-ink-soft">{f.d}</p>
                </>
              );
              const cls = cx(
                "group relative rounded-[1.4rem] bg-gradient-to-b from-mist to-white p-5 ring-1 ring-mist-200 hover:-translate-y-1 hover:shadow-[0_20px_40px_-24px_rgba(8,41,87,0.4)] hover:ring-teal/40",
                r.className,
              );
              return f.href ? (
                <Link key={f.k} href={f.href} className={cls} style={r.style}>
                  {inner}
                </Link>
              ) : (
                <article key={f.k} className={cls} style={r.style}>
                  {inner}
                </article>
              );
            })}
          </div>
        </div>
        <p className="mt-4 text-right">
          <SampleTag>Sample data</SampleTag>
        </p>
      </Container>
    </section>
  );
}
