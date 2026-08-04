import type { Metadata } from "next";
import {
  BellRing,
  CalendarCheck,
  CalendarX,
  Inbox,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { ClosingBand, FeatureCard, PageHero, SectionHeading, Statement } from "../sections";
import { WhatsAppThread } from "../whatsapp-thread";
import { ReplyCheckVisual } from "../reply-check-visual";
import { WhatsAppIcon } from "../whatsapp-icon";
import { pageJsonLd } from "../structured-data";

/**
 * The patient-messaging page.
 *
 * The argument it has to win is not "we send reminders" — everyone sends reminders.
 * It is that a patient can reply in ordinary language and get an answer that was
 * checked against the diary first, which is the difference between a broadcast tool
 * and something that actually removes work from the front desk.
 */

const TITLE = "WhatsApp appointment reminders and booking | FlexicaAI";
const DESCRIPTION =
  "Send appointment reminders and confirmations on WhatsApp, and let patients reply to book or reschedule. Availability is checked before the system answers.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/whatsapp-for-patients" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "FlexicaAI" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const WHAT_GOES_OUT = [
  {
    Icon: CalendarCheck,
    title: "Booking confirmations",
    body: "The moment an appointment is made, the patient has it in writing with the date, the time and who they are seeing. No more calls asking to confirm.",
  },
  {
    Icon: BellRing,
    title: "Day-before reminders",
    body: "Sent automatically the day before, once per appointment. The system records that it went, so nobody is reminded twice and nobody is missed.",
  },
  {
    Icon: CalendarX,
    title: "Cancellation notices",
    body: "If a provider goes on leave, the affected patients are told rather than discovering it at the door.",
  },
  {
    Icon: RefreshCw,
    title: "Recall reminders",
    body: "The follow-up captured at the end of the last visit comes back around on its own, months later, without anyone keeping a list.",
  },
  {
    Icon: Inbox,
    title: "One inbox for the front desk",
    body: "Every message in and out is logged against the patient, so whoever is on the desk can see the whole conversation instead of one person's phone.",
  },
  {
    Icon: Smartphone,
    title: "Nothing for the patient to install",
    body: "No app, no portal, no password. It arrives where they already read their messages, which is why it gets read at all.",
  },
];

const REPLIES = [
  {
    Icon: RefreshCw,
    title: "Rescheduling",
    body: "A patient writes that a day does not work. The system reads the date, checks the provider's hours, leave and daily limit, and only then offers the slot.",
  },
  {
    Icon: CalendarCheck,
    title: "Booking",
    body: "A new request becomes a pending appointment rather than a confirmed one, so your team still has the final say before it enters the diary.",
  },
  {
    Icon: WhatsAppIcon,
    title: "Your own number",
    body: "Messages come from your practice's WhatsApp Business number with your name and sign-off, not from a shared platform number nobody recognises.",
  },
];

export default function WhatsAppForPatientsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            pageJsonLd({
              path: "/whatsapp-for-patients",
              name: "WhatsApp for patients",
              description: DESCRIPTION,
            }),
          ),
        }}
      />

      <PageHero
        eyebrow="Patient messaging"
        lines={["Patients reply.", "The diary", "answers."]}
        lede="Reminders and confirmations go out on their own. When a patient writes back to move an appointment, availability is checked before anyone promises them anything."
        art={<WhatsAppThread className="reveal-up" />}
        artFirst
      />

      <section className="border-y border-foreground/10 bg-muted/40 py-12 sm:py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <SectionHeading
            eyebrow="What goes out"
            title="The messages nobody has time to send"
            lede="Each of these is a job somebody is doing by hand today, or quietly not doing at all."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {WHAT_GOES_OUT.map((c) => (
              <FeatureCard key={c.title} {...c} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <Statement
              eyebrow="What comes back"
              lines={["A reply is not", "a dead end."]}
              lede="Most reminder tools are one-way: the patient answers and it lands nowhere. Here the reply is read, matched to the appointment, and acted on inside the same rules your staff book under."
              cta={{ href: "/ai-medical-scribe", label: "See the AI scribe" }}
            />
          </div>
          <ReplyCheckVisual className="reveal-up" />
        </div>

        <div className="mx-auto mt-12 grid w-full max-w-6xl gap-5 px-4 sm:px-6 md:grid-cols-3">
          {REPLIES.map((c) => (
            <FeatureCard key={c.title} {...c} />
          ))}
        </div>
      </section>

      <ClosingBand
        title="Send yourself a reminder"
        lede="Message us and we will show you the whole loop on a real number: the confirmation, the reminder, the reply, and the diary updating behind it."
      />
    </>
  );
}
