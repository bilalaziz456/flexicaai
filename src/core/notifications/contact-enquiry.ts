import "server-only";

import { BRAND_EMAIL } from "@/core/lib/brand";
import { sendEmail } from "./email";
import { contactEnquiryEmail } from "./email-templates";

/**
 * Delivers a website contact-form enquiry to the company inbox — CORE,
 * specialty-agnostic.
 *
 * Email is the ONLY place an enquiry goes; there is no leads table. So a failed or
 * unconfigured send must reach the visitor as a failure, never as "sent" — a contact
 * form that drops messages while thanking people is worse than having no form. The
 * caller turns `ok: false` into "please WhatsApp or email us instead".
 *
 * Lands in `BRAND_EMAIL`. The contact page prints `SALES_EMAIL`, which core cannot
 * import (ADR-029); both default to the same inbox — keep them in step, or the form
 * and the "Email" card point visitors at two different places.
 *
 * `sendEmail` already reports the failure (by subject, never by address), so nothing
 * is reported twice here.
 */
export async function deliverContactEnquiry(enquiry: {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
}): Promise<{ ok: boolean }> {
  const built = contactEnquiryEmail(enquiry);
  const result = await sendEmail({
    to: BRAND_EMAIL,
    subject: built.subject,
    html: built.html,
    text: built.text,
    replyTo: enquiry.email,
  });
  return { ok: result.ok };
}
