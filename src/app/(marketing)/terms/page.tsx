import type { Metadata } from "next";
import Link from "next/link";
import { Clause, ClauseList, LegalPage } from "../legal";
import { SALES_EMAIL, SALES_EMAIL_URL } from "../contact-details";
import { ORIGIN, pageJsonLd } from "../structured-data";

/**
 * Terms of service.
 *
 * The clause that carries the most weight here is "Clinical responsibility". This
 * product puts an AI draft in front of a clinician, and the single most important
 * thing these terms can do is state plainly that the draft is not a clinical decision
 * and that the person signing it off remains the person responsible. That mirrors the
 * behaviour the software actually enforces, which is that nothing reaches a patient
 * record without approval.
 *
 * Everything else is deliberately ordinary. Terms that try to be clever are terms
 * nobody reads.
 */

const TITLE = "Terms of service | FlexicaAI";
const DESCRIPTION =
  "The agreement covering use of FlexicaAI: accounts, clinical responsibility for AI drafts, your data, fees, availability and how either side can end it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "FlexicaAI" },
};

const STRUCTURED_DATA = pageJsonLd({
  path: "/terms",
  name: "Terms of service",
  description: DESCRIPTION,
});

export default function TermsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <LegalPage
        title="Terms of service"
        updated="5 August 2026"
        intro={
          <>
            <p>
              These terms cover the use of FlexicaAI by a health practice and by the
              people working in it. By using the software you are agreeing to them.
            </p>
            <p>
              They are written to be read. If something here is unclear, ask us before
              you rely on your own reading of it.
            </p>
          </>
        }
      >
        <Clause title="Who this is between">
          <p>
            This agreement is between FlexicaAI and the practice that holds the account.
            Where a practice gives access to its staff, the practice is responsible for
            what those accounts do.
          </p>
        </Clause>

        <Clause title="Accounts and access">
          <p>
            There is no public sign-up. We create an account for a practice, and the
            practice&apos;s administrator creates accounts for its own staff and decides
            what each of them can reach.
          </p>
          <ClauseList
            items={[
              "Sign-in details belong to one person and are not to be shared.",
              "The practice is responsible for removing access when someone leaves.",
              "Tell us promptly if you think an account has been compromised.",
              "We may suspend an account where there is a security risk, unpaid fees past the agreed grace period, or use that breaks these terms.",
            ]}
          />
        </Clause>

        <Clause title="Clinical responsibility">
          <p>
            This is the most important clause in this document, so it is not buried at
            the bottom.
          </p>
          <p>
            FlexicaAI produces drafts. The voice scribe turns a recorded consultation
            into a suggested note, and the software can suggest medications from a list
            the practice maintains. None of that is a clinical decision, a diagnosis or
            medical advice, and none of it replaces the judgement of a qualified
            clinician.
          </p>
          <ClauseList
            items={[
              "A clinician must read and approve every note before it becomes part of a patient record. The software is built to require this and will not finalise a note on its own.",
              "A clinician is responsible for every prescription issued through the product, including dosage, interactions and suitability for the patient.",
              "Where the transcription is unclear the software flags it rather than guessing. It is the clinician's job to resolve the flag, not to assume it is right.",
              "The practice remains responsible for meeting its own regulatory, licensing and record-keeping obligations.",
            ]}
          />
          <p>
            Put simply, we are responsible for the software working as described. The
            clinician remains responsible for the care.
          </p>
        </Clause>

        <Clause title="Acceptable use">
          <p>You agree not to:</p>
          <ClauseList
            items={[
              "Upload data you have no right to hold, or use the product for anyone other than the practice's own patients.",
              "Attempt to reach another practice's records, or to get around the access controls in the product.",
              "Probe, scan or attack the service, or use it to send unlawful or unsolicited messages.",
              "Resell or rebrand the service without a written agreement with us.",
              "Use the product where doing so would be against the law that applies to you.",
            ]}
          />
        </Clause>

        <Clause title="Your data stays yours">
          <p>
            The practice owns the records it puts into FlexicaAI. We hold and process
            them to run the service, as set out in the{" "}
            <Link
              href="/privacy"
              className="text-foreground underline underline-offset-4 hover:text-primary-text"
            >
              privacy policy
            </Link>
            .
          </p>
          <p>
            We can provide an export of a practice&apos;s data on request, both during
            the agreement and when it ends. Note the retention behaviour described in the
            privacy policy: deleting a record moves it to Trash rather than erasing it,
            and permanent erasure is something we perform on request.
          </p>
        </Clause>

        <Clause title="Fees">
          <p>
            Subscription fees, the billing period and any grace period are whatever we
            have agreed with the practice in writing. Fees are payable in advance for the
            agreed period unless we have said otherwise.
          </p>
          <p>
            If an account goes unpaid past the agreed grace period we may restrict access
            until it is settled. We will make the position clear before we do that rather
            than cutting a practice off mid-clinic without warning.
          </p>
          <p>
            If we change our prices we will give notice before the change applies to a
            practice&apos;s next billing period.
          </p>
        </Clause>

        <Clause title="Availability">
          <p>
            We work to keep the service running and we will give notice of planned
            maintenance where we reasonably can. We do not promise uninterrupted or
            error-free service, and parts of the product depend on outside providers such
            as WhatsApp and the AI services named in the privacy policy. When one of those
            has an outage, the feature that depends on it will be affected.
          </p>
          <p>
            Practices should keep their own arrangements for continuing to see patients
            if any software they use is unavailable.
          </p>
        </Clause>

        <Clause title="Liability">
          <p>
            The service is provided as it is. To the extent the law allows, we exclude
            implied warranties, and we are not liable for lost profits, lost business or
            indirect losses.
          </p>
          <p>
            To the extent the law allows, our total liability under this agreement in any
            twelve month period is limited to the fees paid by the practice in that
            period.
          </p>
          <p>
            Nothing here limits liability that cannot lawfully be limited, and nothing
            here reduces a clinician&apos;s own responsibility for clinical decisions.
          </p>
        </Clause>

        <Clause title="Ending the agreement">
          <p>
            A practice can stop using FlexicaAI at any time by telling us. We can end the
            agreement with reasonable notice, or immediately where there is a serious
            breach of these terms or a legal requirement to do so.
          </p>
          <p>
            When the agreement ends we will make an export of the practice&apos;s data
            available for a reasonable period before removing it.
          </p>
        </Clause>

        <Clause title="Changes to these terms">
          <p>
            We may update these terms. Where a change materially affects a practice we
            will give notice rather than relying on the date at the top of this page
            changing. Continuing to use the service after a change takes effect means
            accepting it.
          </p>
        </Clause>

        <Clause title="Governing law">
          <p>
            This agreement is governed by the laws of the Islamic Republic of Pakistan,
            and the courts of Pakistan have jurisdiction. Where we have signed a separate
            written agreement with a practice that says otherwise, that agreement takes
            precedence over this page.
          </p>
        </Clause>

        <Clause title="Contact us">
          <p>
            Questions about these terms can go to{" "}
            <a
              href={SALES_EMAIL_URL}
              className="text-foreground underline underline-offset-4 hover:text-primary-text"
            >
              {SALES_EMAIL}
            </a>
            .
          </p>
          <p className="text-xs">FlexicaAI, {ORIGIN.replace("https://", "")}</p>
        </Clause>
      </LegalPage>
    </>
  );
}
