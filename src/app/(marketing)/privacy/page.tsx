import type { Metadata } from "next";
import Link from "next/link";
import { Clause, ClauseList, LegalPage } from "../legal";
import { SALES_EMAIL, SALES_EMAIL_URL, SALES_PHONE_DISPLAY } from "../contact-details";
import { ORIGIN, pageJsonLd } from "../structured-data";

/**
 * Privacy policy.
 *
 * Written against what the software actually does, not from a template. Every factual
 * claim here is checkable in the codebase: the cookie names and flags, the named
 * sub-processors, the models, the soft-delete retention behaviour and the audit log.
 * If any of that changes, this page changes with it. A policy that describes a
 * different product than the one running is worse than no policy.
 *
 * The structure follows the one distinction that matters for a B2B health product:
 * a visitor to this website and a patient whose record sits inside a practice's
 * account are in completely different relationships with us, and merging them into
 * one "we collect your data" section would misdescribe both.
 */

const TITLE = "Privacy policy | FlexicaAI";
const DESCRIPTION =
  "How FlexicaAI handles practice and patient data, which processors are involved, how long records are kept, and how to reach us about a request.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/privacy" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "FlexicaAI" },
};

const STRUCTURED_DATA = pageJsonLd({
  path: "/privacy",
  name: "Privacy policy",
  description: DESCRIPTION,
});

export default function PrivacyPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <LegalPage
        title="Privacy policy"
        updated="5 August 2026"
        intro={
          <>
            <p>
              FlexicaAI provides an AI-powered health management system to health
              practices. This policy explains what we do with information, and it
              separates two very different situations, because they carry different
              obligations.
            </p>
            <p>
              If you are simply reading this website, almost none of it applies to you.
              We do not ask you for anything here. If you are a practice using FlexicaAI,
              or a patient of one, the sections from{" "}
              <span className="text-foreground">Using FlexicaAI</span> onwards are the
              ones that matter.
            </p>
          </>
        }
      >
        <Clause title="Visiting this website">
          <p>
            This site has no sign-up form, no contact form and no comment box. There is
            nowhere on it to type anything, so we collect nothing about you here. Getting
            in touch means WhatsApp, email or a phone call, and at that point you have
            chosen what to tell us.
          </p>
          <p>
            We set one cookie on the public site. It is called{" "}
            <code className="rounded bg-foreground/5 px-1 py-0.5 font-mono text-xs">
              klenic_theme
            </code>
            , it stores nothing but the word light or dark, and it exists so the page does
            not flash the wrong colour when you come back. It is not used to identify you
            or to follow you anywhere.
          </p>
          <p>
            There is no analytics, no advertising pixel and no third-party tracker on this
            site. Our hosting provider keeps standard server logs, which include IP
            addresses, for security and troubleshooting.
          </p>
        </Clause>

        <Clause title="Using FlexicaAI">
          <p>
            When a practice uses FlexicaAI, the practice decides what is recorded about
            its patients and why. In data protection terms the practice is the
            controller and we are the processor. We hold and process that information to
            run the service the practice has asked for, and not for our own purposes.
          </p>
          <p>Depending on which parts of the product a practice uses, this can include:</p>
          <ClauseList
            items={[
              "Staff account details, which is a name, username, email address, role and permissions.",
              "Patient details, which is a name, phone number, age or date of birth, gender, address and any notes the practice adds.",
              "Appointments, visits and clinical notes, including the audio of a consultation where the voice scribe is used and the transcript produced from it.",
              "Prescriptions and treatment plans.",
              "Money records, meaning invoices, receipts, payments, discounts and expenses.",
              "WhatsApp messages sent to and received from patients, together with their delivery status.",
              "An activity log of actions taken in the account, which records who did what and when.",
            ]}
          />
          <p>
            We do not sell any of this, we do not share it with advertisers, and we do
            not use one practice&apos;s data to benefit another. Each practice&apos;s
            records are scoped to that practice and every query is filtered by it.
          </p>
        </Clause>

        <Clause title="Artificial intelligence, and what leaves our systems">
          <p>
            Two features send content to outside providers, and we would rather be
            specific about it than hide it behind the word cloud.
          </p>
          <ClauseList
            items={[
              <>
                <span className="text-foreground">Voice scribe.</span> When a clinician
                records a consultation, the audio is sent to OpenAI for transcription
                using the Whisper model, and the resulting text is sent to Anthropic to
                be structured into a draft note using Claude. Both may therefore process
                clinical content and anything the clinician said aloud.
              </>,
              <>
                <span className="text-foreground">Message drafting.</span> Where the
                product suggests a reply to a patient message, the message text is sent
                to Anthropic for the same reason.
              </>,
            ]}
          />
          <p>
            Every output of these features arrives as a draft. It is not saved to a
            patient record until a clinician has reviewed it and approved it. The
            software will not finalise a clinical note or a prescription on its own.
          </p>
          <p>
            We keep the original AI draft alongside the clinician&apos;s corrected
            version. That is how we measure whether the scribe is getting better or
            worse, and it stays inside the practice&apos;s own account.
          </p>
        </Clause>

        <Clause title="WhatsApp messages">
          <p>
            Appointment confirmations, reminders, recall messages and receipts are
            delivered over WhatsApp. That means a patient&apos;s phone number and the
            content of the message pass through our messaging provider and through Meta,
            which operates WhatsApp. Their handling of the message is governed by their
            own terms, which we do not control.
          </p>
          <p>
            A patient who does not want these can tell the practice, which can stop them.
          </p>
        </Clause>

        <Clause title="Who else is involved">
          <p>
            We keep the list of outside providers short on purpose. At the time of
            writing it is:
          </p>
          <ClauseList
            items={[
              "Our hosting and database providers, who store the data and run the application.",
              "OpenAI, for voice transcription.",
              "Anthropic, for turning a transcript into a structured draft.",
              "Our WhatsApp messaging provider, and Meta, for delivering messages.",
            ]}
          />
          <p>
            Each of them receives only what their function needs. If we add a provider
            that handles patient data, we will update this page.
          </p>
        </Clause>

        <Clause title="How long we keep things">
          <p>
            This one deserves plain language, because our deletion behaviour is
            deliberately not what people assume.
          </p>
          <p>
            Deleting a record in FlexicaAI does not erase it. It moves to a Trash area
            where the practice can restore it, by default for 30 days. After that window
            it disappears from the practice&apos;s view, but it is still held in the
            database. This is intentional. Health records get deleted by accident, and a
            patient history that can be destroyed by one mis-click is a liability for the
            practice and for the patient.
          </p>
          <p>
            Permanent erasure is possible and is performed by us on request, for example
            where a practice has a legal obligation to erase a record. Ask us and we will
            do it.
          </p>
          <p>
            While an account is active we keep its data for as long as the practice
            keeps using the service. If a practice leaves, we can return an export of its
            data and then remove it.
          </p>
        </Clause>

        <Clause title="How it is protected">
          <p>These are the measures actually in place, not aspirations:</p>
          <ClauseList
            items={[
              "Traffic is encrypted in transit over HTTPS.",
              "Passwords are stored as bcrypt hashes and are never recoverable, by us or by anyone else.",
              "Sessions use an opaque token in a cookie that JavaScript cannot read, and only a hash of that token is stored.",
              "Access is role based and can be narrowed per person, so a receptionist need not see clinical notes.",
              "Every practice's records are separated, and each request is scoped to a single practice.",
              "Actions on patient data are written to an audit log.",
            ]}
          />
          <p>
            No system is perfectly secure, and we will not claim otherwise. If we become
            aware of a breach affecting a practice&apos;s data, we will tell that practice
            without unnecessary delay.
          </p>
        </Clause>

        <Clause title="Where the data is">
          <p>
            The application and its database are hosted with our infrastructure
            providers, and the AI and messaging providers named above operate
            internationally, so processing can take place outside your country. We are
            building towards keeping data in the region it comes from, and we will say so
            here when that is in place rather than before.
          </p>
        </Clause>

        <Clause title="Patient requests">
          <p>
            If you are a patient and you want to see, correct or remove what a practice
            holds about you, ask the practice. They control the record and they can act
            on it directly. If they need us to help, they can contact us and we will.
          </p>
          <p>
            We do not act on a patient request on our own, because we cannot verify who
            you are or what your relationship with the practice is. The practice can.
          </p>
        </Clause>

        <Clause title="Changes to this policy">
          <p>
            If we change how we handle information we will update this page and move the
            date at the top. Where a change is significant for practices using the
            product, we will tell them directly rather than relying on them noticing.
          </p>
        </Clause>

        <Clause title="Contact us">
          <p>
            Questions about this policy, or a request about data, can go to{" "}
            <a
              href={SALES_EMAIL_URL}
              className="text-foreground underline underline-offset-4 hover:text-primary-text"
            >
              {SALES_EMAIL}
            </a>{" "}
            or {SALES_PHONE_DISPLAY}. Our terms of service are on the{" "}
            <Link
              href="/terms"
              className="text-foreground underline underline-offset-4 hover:text-primary-text"
            >
              terms page
            </Link>
            .
          </p>
          <p className="text-xs">
            FlexicaAI, {ORIGIN.replace("https://", "")}
          </p>
        </Clause>
      </LegalPage>
    </>
  );
}
