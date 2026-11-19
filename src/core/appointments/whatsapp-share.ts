/**
 * "Send on WhatsApp" from an appointment (owner, 2026-11-20) — the message staff send
 * from THEIR OWN WhatsApp (the app or WhatsApp Web), not through the WhatsApp API: the
 * button opens a chat with the patient with this text already typed, and the person
 * presses Send. PURE (no DB, no `server-only`), so it is tested on its own
 * (`scripts/test-whatsapp-share.ts`).
 */

export type AppointmentShare = {
  patientName: string;
  clinicName: string;
  /** "20 Nov 2026, 09:00 AM", formatted by the caller in the clinic's time. */
  when: string;
  queueNumber: number | null;
  doctor: string | null;
  /** Only when the person may see the bill and there is one. */
  bill?: { invoice: string | null; total: string; paid: string; due: string } | null;
  /** The clinic's address / number, to close the message. */
  contact?: string | null;
};

/** The message, one fact per line so it reads well on a phone. */
export function appointmentWhatsAppText(a: AppointmentShare): string {
  const lines = [
    `Dear ${a.patientName},`,
    `Your appointment at ${a.clinicName}:`,
    `Date: ${a.when}`,
    a.queueNumber != null ? `Appointment no.: ${a.queueNumber}` : null,
    a.doctor ? `Doctor: ${a.doctor}` : null,
  ];
  if (a.bill) {
    lines.push(
      "",
      a.bill.invoice ? `Invoice ${a.bill.invoice}` : "Bill",
      `Total: ${a.bill.total}`,
      `Paid: ${a.bill.paid}`,
      `Due: ${a.bill.due}`,
    );
  }
  lines.push("", a.clinicName);
  if (a.contact) lines.push(a.contact);
  return lines.filter((l): l is string => l !== null).join("\n");
}

/**
 * An INVOICE as text (owner, 2026-11-20): what was billed and what is still due — no
 * appointment number, which belongs to the visit, not the bill.
 */
export function invoiceWhatsAppText(
  p: { patientName: string; clinicName: string; contact?: string | null },
  inv: { invoice: string | null; date: string; total: string; paid: string; due: string },
): string {
  return [
    `Dear ${p.patientName},`,
    `Your invoice from ${p.clinicName}:`,
    ...(inv.invoice ? [`Invoice no.: ${inv.invoice}`] : []),
    `Date: ${inv.date}`,
    "",
    `Total: ${inv.total}`,
    `Paid: ${inv.paid}`,
    `Due: ${inv.due}`,
    "",
    p.clinicName,
    ...(p.contact ? [p.contact] : []),
  ].join("\n");
}

/** Who the message is to and from — the same on every document. */
export type ShareParty = {
  patientName: string;
  phone: string | null;
  clinicName: string;
  /** The clinic's address / number, to close the message. */
  contact: string | null;
};

const close = (p: ShareParty): string[] => ["", p.clinicName, ...(p.contact ? [p.contact] : [])];

/** A prescription as text: one line per medicine, with how to take it. */
export function prescriptionWhatsAppText(
  p: ShareParty,
  rx: { date: string; doctor: string | null; lines: string[]; notes: string | null },
): string {
  return [
    `Dear ${p.patientName},`,
    `Your prescription from ${p.clinicName} (${rx.date}):`,
    ...(rx.doctor ? [`Doctor: ${rx.doctor}`] : []),
    "",
    ...rx.lines.map((l, i) => `${i + 1}. ${l}`),
    ...(rx.notes ? ["", `Notes: ${rx.notes}`] : []),
    ...close(p),
  ].join("\n");
}

/** A treatment plan as text: each treatment with its price, then the total. */
export function planWhatsAppText(
  p: ShareParty,
  plan: { title: string; doctor: string | null; items: { name: string; amount: string }[]; discount?: string | null; total: string; note: string | null },
): string {
  return [
    `Dear ${p.patientName},`,
    `Your treatment plan at ${p.clinicName}: ${plan.title}`,
    ...(plan.doctor ? [`Doctor: ${plan.doctor}`] : []),
    "",
    ...plan.items.map((i) => `• ${i.name} — ${i.amount}`),
    // The plan's overall discount, so the lines above add up to the total.
    ...(plan.discount ? [`Discount: − ${plan.discount}`] : []),
    `Total: ${plan.total}`,
    ...(plan.note ? ["", plan.note] : []),
    ...close(p),
  ].join("\n");
}

/**
 * The link that opens WhatsApp on that chat — wa.me works on a phone (the app) and on
 * a computer (the app if installed, else WhatsApp Web). The number goes in digits only,
 * with its country code ("+923450186120" → "923450186120"). With no number WhatsApp
 * opens with the text ready and lets the person choose the chat.
 */
export function whatsAppChatUrl(phoneE164: string | null | undefined, text: string): string {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  const to = digits.length >= 8 ? digits : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
