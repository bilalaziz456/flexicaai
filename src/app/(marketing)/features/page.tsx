import { ChartColumnIncreasing, HeartPulse, Stethoscope, Users, Wallet, Building2, CalendarDays, Check } from "lucide-react";
import Link from "next/link";
import { ShowcaseVisual, type ShowcaseKey } from "@/site/components/mockups/showcase";
import { PageMotion } from "@/site/components/pages3d/page-motion";
import { PlatformHero } from "@/site/components/pages3d/platform-hero";
import { PlatformStory } from "@/site/components/pages3d/platform-story";
import { Band, CtaBand, CtaButtons, PageHero } from "@/site/components/site/page-blocks";
import { Ambient, FeatureCards, IconTile, SpotCard } from "@/site/components/site/rich";
import { Container, Eyebrow, JsonLd, SampleTag, SectionHeading } from "@/site/components/ui";
import { FEATURE_LINKS, featurePath } from "@/site/lib/nav";
import { SOFTWARE_APPLICATION, pageJsonLd, pageMetadata } from "@/site/lib/site";

const TITLE = "Clinic Management Software Features";
const DESCRIPTION =
  "Every FlexicaAI feature: patients, appointments, the AI clinical scribe, WhatsApp, billing, analytics, prescriptions, recalls, permissions and more.";

export const metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/features" });

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Features", path: "/features" },
];

/** The six areas, each with the mock that best shows it. */
const AREAS: { key: ShowcaseKey; index: number }[] = [
  { key: "patients", index: 0 },
  { key: "appointments", index: 1 },
  { key: "billing", index: 5 },
];

const GROUP_ICON = { "The diary": CalendarDays, "The patient": HeartPulse, "The money": Wallet, "The clinic": Building2 } as const;

const CAPABILITIES: { group: keyof typeof GROUP_ICON; items: { t: string; d: string }[] }[] = [
  {
    group: "The diary",
    items: [
      { t: "Doctor schedules", d: "Working hours per weekday, flexible hours and a daily appointment cap per doctor." },
      { t: "Doctor leave", d: "Leave cancels appointments in its range and blocks new bookings — patients are told." },
      { t: "Live queue", d: "Token numbers, arrivals and who is with the doctor, for the front desk." },
      { t: "No-shows", d: "Missed appointments listed on their own, ready for follow-up." },
    ],
  },
  {
    group: "The patient",
    items: [
      { t: "Medical history", d: "Allergies, conditions and current medicines, shown before treatment." },
      { t: "Attachments & lab work", d: "X-rays, lab reports and photos on the record, and lab work tracking." },
      { t: "Treatment plans & estimates", d: "Plans with per-treatment and overall discounts, printed on your letterhead." },
      { t: "Prescriptions on letterhead", d: "A4 on the clinic letterhead, or without it for pre-printed pads." },
      { t: "Recalls", d: "Follow-ups fall due on their own and go out on WhatsApp." },
    ],
  },
  {
    group: "The money",
    items: [
      { t: "Sales & receivables", d: "Realised revenue by service and period, and who still owes what." },
      { t: "Discounts with approvals", d: "Per-line and per-visit discounts, approved by whoever bears them." },
      { t: "Doctor revenue shares", d: "Shares that follow the price actually charged." },
      { t: "Petty cash", d: "The front-desk drawer, reconciled at each handover." },
      { t: "Profit & loss", d: "Sales, shares and expenses brought together into net profit." },
    ],
  },
  {
    group: "The clinic",
    items: [
      { t: "Roles & permissions", d: "Access granted per person and per capability — never a shared login." },
      { t: "Activity log", d: "Who did what, and when, for every action on patient data." },
      { t: "Restorable trash", d: "Nothing is hard-deleted; deleted items can be restored." },
      { t: "Any printer", d: "Receipts and invoices on a thermal roll, A5 or A4." },
      { t: "Reports as PDF", d: "Every report downloads as a tidy PDF to share or file." },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <JsonLd data={pageJsonLd({ path: "/features", name: TITLE, description: DESCRIPTION, crumbs, extra: [SOFTWARE_APPLICATION] })} />
      <PageHero
        crumbs={crumbs}
        eyebrow="The features"
        title="One connected workspace for the whole clinic."
        lead="FlexicaAI is clinic management software built for clinics in Pakistan. The front desk, every doctor and the owner work in the same system — from the first WhatsApp message to the monthly profit and loss."
        aside={<PlatformHero />}
      >
        <CtaButtons />
      </PageHero>

      <PlatformStory />

      <Band tone="white" labelledBy="areas-title" ambient>
        <SectionHeading
          id="areas-title"
          eyebrow="Six core areas"
          title="Start where your clinic feels the pressure."
          lead="Each area works on its own, and each makes the others better: a WhatsApp booking lands in the diary, the visit becomes a note, the note becomes a bill, the bill becomes the P&L."
        />
        <div className="mt-14">
          <FeatureCards numbered cta="Learn more" />
        </div>
      </Band>

      <Band tone="mist" labelledBy="inside-title" ambient>
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <SectionHeading
            id="inside-title"
            eyebrow="Inside the app"
            title="What your team actually sees."
            lead="Patient records, the doctor's day and the bill — the screens the front desk and doctors use all day."
          />
          <SampleTag>Illustrations · invented sample data</SampleTag>
        </div>
        <div className="relative mt-14 grid items-start gap-8 lg:grid-cols-3">
          {AREAS.map((a) => (
            <figure key={a.key} className="flex flex-col items-center gap-4">
              <ShowcaseVisual k={a.key} />
              <figcaption className="text-[0.9rem] text-ink-soft">
                <Link href={featurePath(FEATURE_LINKS[a.index].slug)} className="font-semibold text-teal-ink underline-offset-4 hover:underline">
                  {FEATURE_LINKS[a.index].name}
                </Link>
              </figcaption>
            </figure>
          ))}
        </div>
      </Band>

      <section className="band-dark grain relative overflow-hidden py-20 lg:py-28" aria-labelledby="caps-title">
        <Ambient dark />
        <Container className="relative">
          <SectionHeading
            id="caps-title"
            dark
            eyebrow="And everything around it"
            title="The parts nobody puts on a brochure — and every clinic needs."
          />
          <div className="mt-16 grid gap-6 md:grid-cols-2">
            {CAPABILITIES.map((g) => (
              <SpotCard key={g.group} dark tilt={false}>
                <div className="flex items-center gap-4">
                  <IconTile icon={GROUP_ICON[g.group]} />
                  <h3 className="eyebrow text-teal-glow">{g.group}</h3>
                </div>
                <dl className="mt-6 grid gap-1">
                  {g.items.map((it) => (
                    <div key={it.t} className="grid grid-cols-[1.25rem_1fr] gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-white/[0.04]">
                      <Check className="mt-1 size-4 text-teal-glow" aria-hidden />
                      <div>
                        <dt className="font-semibold text-white">{it.t}</dt>
                        <dd className="mt-0.5 text-[0.93rem] leading-relaxed text-slate-400">{it.d}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              </SpotCard>
            ))}
          </div>
        </Container>
      </section>

      <Band tone="white" labelledBy="modules-title" ambient>
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <Eyebrow>Built for clinics</Eyebrow>
            <h2 id="modules-title" className="text-h2 mt-5 text-ink">
              One shared core, set up around your clinic.
            </h2>
            <p className="text-lead mt-6 text-ink-soft">
              Appointments, patients, WhatsApp, the AI scribe, billing and finance are one system. Your doctors, their
              hours and daily limits, your services and fees, your printers and your letterhead are configured for you.
            </p>
            <p className="mt-5 text-[0.98rem] leading-relaxed text-ink-soft">
              Read more <Link href="/about" className="font-semibold text-teal-ink underline underline-offset-4">about how FlexicaAI is built</Link>.
            </p>
          </div>
          <div className="relative" data-reveal>
            <div className="ring-spin mx-auto w-fit rounded-2xl px-6 py-4 text-center shadow-[0_0_50px_rgb(15_180_187/0.35)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-teal-glow">FlexicaAI core</p>
              <p className="mt-1 text-[13px] text-slate-300">One record per patient</p>
            </div>
            <div className="beam beam-y relative mx-auto h-10 w-px bg-teal/40" aria-hidden />
            <div className="beam relative mx-auto h-px w-2/3 bg-teal/40" aria-hidden />
            <ul className="mt-0 grid gap-4 sm:grid-cols-3">
              {[
                { t: "Front desk", d: "Bookings, arrivals, the queue and the bill", icon: Users },
                { t: "Doctors", d: "Records, notes, plans and prescriptions", icon: Stethoscope },
                { t: "Owner", d: "Sales, expenses, shares and profit and loss", icon: ChartColumnIncreasing },
              ].map((r) => (
                <li key={r.t} className="flex flex-col items-center">
                  <div className="beam beam-y relative h-8 w-px bg-teal/40" aria-hidden />
                  <SpotCard className="text-center">
                    <IconTile icon={r.icon} className="mx-auto" />
                    <p className="mt-4 text-lg font-semibold text-ink">{r.t}</p>
                    <p className="mt-1 text-[13px] leading-snug text-ink-soft">{r.d}</p>
                  </SpotCard>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Band>

      <CtaBand />
      <PageMotion />
    </>
  );
}
