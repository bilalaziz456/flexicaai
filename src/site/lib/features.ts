import type { FeatureSlug } from "./nav";

/**
 * Content for the six feature pages (app/(marketing)/features/[slug]).
 *
 * Every statement here describes what the FlexicaAI app does today. Planned work
 * (WhatsApp message credits, per-clinic automation switches, other WhatsApp
 * providers) is deliberately absent.
 */

export type FeatureSection = {
  h2: string;
  paragraphs: string[];
  points?: string[];
};

export type FeatureContent = {
  slug: FeatureSlug;
  name: string;
  metaTitle: string;
  metaDescription: string;
  eyebrow: string;
  h1: string;
  intro: string;
  sections: FeatureSection[];
  steps: { title: string; text: string }[];
  faqs: { q: string; a: string }[];
  related: FeatureSlug[];
};

export const FEATURES: FeatureContent[] = [
  {
    slug: "patient-management",
    name: "Patient Management",
    metaTitle: "Patient Management System for Clinics",
    metaDescription:
      "One record per patient: medical history, allergies, attachments, visits, treatment plans, estimates and prescriptions — built for busy clinics.",
    eyebrow: "Patient management",
    h1: "Every patient's story, in one record your whole team can trust.",
    intro:
      "FlexicaAI is a patient management system that keeps the full picture together: who the patient is, what they are allergic to, what was found at each visit, what is planned next and what has been prescribed. The front desk, the doctor and the owner all open the same record — each seeing what their role allows.",
    sections: [
      {
        h2: "A record that starts at the front desk and follows the patient",
        paragraphs: [
          "A patient is registered once, with a medical record number from your clinic's own series that never changes. Every appointment, visit, note, bill and message after that hangs off the same record, so nobody has to search three registers to answer a simple question.",
          "Patients can also arrive with a balance from your previous system: an opening balance can be recorded so the money history starts in the right place.",
        ],
        points: [
          "Clinic-specific MRN series (for example FA-100001), stored for life",
          "Contact details, age, gender and the patient's own notes",
          "Every visit, appointment, invoice and WhatsApp message in one timeline",
        ],
      },
      {
        h2: "Medical history that is visible when it matters",
        paragraphs: [
          "Allergies, conditions and current medicines are recorded on the patient and shown to the doctor before treatment. Attachments such as X-rays, lab reports and photos sit on the record, next to the note that refers to them.",
          "Lab work tracking sits in the same record, so the clinical side and the follow-up work are not split across paper and spreadsheets.",
        ],
      },
      {
        h2: "Treatment plans and estimates patients can take home",
        paragraphs: [
          "A plan lists the treatments the doctor proposes, with your clinic's prices. Discounts can be given per treatment or across the plan, and the plan records whether the clinic, the doctor or both bear them.",
          "The estimate prints on the clinic's letterhead. When the patient goes ahead, items are booked straight from the plan — each with its share of the plan discount already on its own line.",
        ],
      },
      {
        h2: "Prescriptions on your letterhead",
        paragraphs: [
          "Prescriptions are typed with medicine lines suggested from a shared medicine list plus your clinic's own list, and printed or downloaded as A4 on the clinic letterhead — or without it, for pre-printed pads. When a doctor approves a note from the AI clinical scribe, its medicines become a prescription automatically; the signed note itself is never altered.",
        ],
      },
    ],
    steps: [
      { title: "Register", text: "The desk adds the patient once; the MRN is issued from your series." },
      { title: "Record history", text: "Allergies, conditions, medicines and attachments are captured." },
      { title: "Plan and treat", text: "The doctor records findings, plans treatment and prints an estimate." },
      { title: "Prescribe and follow up", text: "Prescriptions print on letterhead; follow-up recalls bring the patient back." },
    ],
    faqs: [
      {
        q: "Can the receptionist see clinical notes?",
        a: "Only if the clinic grants it. Access is set per person and per capability, so the front desk can manage appointments and billing without seeing clinical notes.",
      },
      {
        q: "What happens if a patient record is deleted by mistake?",
        a: "Nothing is permanently deleted. The record moves to Trash, where it can be restored, and the activity log shows who deleted it and when.",
      },
      {
        q: "Can we bring patients over from our current system?",
        a: "Yes. Patients can be imported, and a balance they already owe can be recorded as an opening balance so their account is correct from day one.",
      },
    ],
    related: ["appointment-management", "ai-scribe", "billing-and-payments"],
  },
  {
    slug: "appointment-management",
    name: "Appointment Management",
    metaTitle: "Clinic Appointment Management Software",
    metaDescription:
      "Doctor calendars, working hours, daily caps, leave and a live queue. Every booking — at the desk or on WhatsApp — is checked against the same rules.",
    eyebrow: "Appointment management",
    h1: "A calm diary for every doctor, even on your busiest day.",
    intro:
      "FlexicaAI's appointment management software gives each doctor a calendar built on their real working hours. Bookings made at the desk and requests made by patients on WhatsApp go through the same availability check, so the diary never promises a slot the clinic cannot keep.",
    sections: [
      {
        h2: "Working hours, daily caps and leave — set once, respected everywhere",
        paragraphs: [
          "Each doctor has working hours per weekday, an optional daily appointment cap and a consultation fee. The week grid shows who is in, who is away and what is already booked against them.",
          "When a doctor takes leave, appointments in that period are cancelled and new bookings are blocked — and patients are told on WhatsApp, so nobody turns up to an empty consulting room.",
        ],
        points: [
          "Per-weekday hours and flexible hours",
          "A daily cap per doctor",
          "Leave that cancels and blocks bookings in its range",
        ],
      },
      {
        h2: "From scheduled to completed, at a glance",
        paragraphs: [
          "Every appointment moves through clear states — scheduled, confirmed, arrived and completed — or is marked a no-show. The front desk sees today's queue with token numbers, marks patients as they arrive and opens their record in one click.",
          "No-shows are listed on their own page, so the clinic can follow up instead of losing the patient.",
        ],
      },
      {
        h2: "Bookings that arrive on WhatsApp",
        paragraphs: [
          "Patients can ask for an appointment by replying on WhatsApp. FlexicaAI asks which doctor, offers that doctor's hours, checks the requested time and records the request with a token number. The clinic confirms it and the patient receives the confirmation — then a reminder the day before.",
        ],
      },
    ],
    steps: [
      { title: "Book", text: "At the desk, or as a request from WhatsApp." },
      { title: "Confirm", text: "The patient receives a WhatsApp confirmation." },
      { title: "Remind", text: "A reminder goes out the day before." },
      { title: "Arrive and complete", text: "The desk marks arrival; the visit is completed and billed." },
    ],
    faqs: [
      {
        q: "Can two bookings land in the same slot?",
        a: "Every booking and reschedule is checked against the doctor's working hours, daily cap and leave by the same rule, whether it comes from the desk or from WhatsApp.",
      },
      {
        q: "Who can change a doctor's working hours?",
        a: "The clinic admin manages each doctor's hours and fee. Managers can adjust the daily cap, and everyone can view the schedule — a doctor sees their own row.",
      },
      {
        q: "Do patients get reminded automatically?",
        a: "Yes. A day-before reminder is sent on WhatsApp for upcoming appointments, along with booking confirmations and cancellation notices.",
      },
    ],
    related: ["whatsapp-integration", "patient-management", "clinic-analytics"],
  },
  {
    slug: "ai-scribe",
    name: "AI Clinical Scribe",
    metaTitle: "AI Clinical Scribe for Doctors' Notes",
    metaDescription:
      "Dictate the consultation and FlexicaAI drafts a structured clinical note — examination, diagnosis, treatment, medicines. The doctor reviews and approves it.",
    eyebrow: "AI clinical scribe",
    h1: "Speak the consultation. Review a structured clinical note.",
    intro:
      "The AI clinical scribe turns a doctor's dictation into a structured clinical note. Audio is transcribed, then AI organises it into the sections a clinical record needs. The result is always a draft: the doctor who dictated it reads it, edits it and approves it before it becomes part of the patient's record.",
    sections: [
      {
        h2: "Built around how doctors actually dictate",
        paragraphs: [
          "Consultations in Pakistan rarely stay in one language. The scribe handles the mix of English and Urdu a doctor naturally uses, and the note is drafted in the background while the next patient sits down.",
          "The note is organised the way a clinical record is read: complaint, history, examination, investigations, diagnosis, treatment, plan, medicines and the next visit.",
        ],
      },
      {
        h2: "Unclear audio is flagged — never guessed",
        paragraphs: [
          "If part of the recording cannot be made out, the draft says so and marks it for the doctor to confirm. It does not fill the gap with something plausible. Medicines that are not on the clinic's list, or that conflict with an allergy recorded for the patient, are flagged for the doctor.",
        ],
        points: [
          "Flagged sections for anything the AI could not hear clearly",
          "Medicines flagged against your list and the patient's allergies",
          "The original draft is kept beside the approved version",
        ],
      },
      {
        h2: "The doctor approves — always",
        paragraphs: [
          "No AI output becomes a medical record on its own. Approval requires the clinical permission, and only the author of a draft can approve or reopen it. When a note is approved, its medicines become a prescription the desk can print on the clinic letterhead.",
          "FlexicaAI keeps the AI's draft alongside the doctor's corrected version inside the clinic's account, so the clinic can see what was changed.",
        ],
      },
    ],
    steps: [
      { title: "Record", text: "The doctor records the consultation or dictates afterwards." },
      { title: "Transcribe", text: "The audio is transcribed to text." },
      { title: "Structure", text: "AI organises the transcript into a draft clinical note." },
      { title: "Review and approve", text: "The doctor edits, resolves flags and approves." },
    ],
    faqs: [
      {
        q: "Does the AI write the final medical record?",
        a: "No. It writes a draft. The doctor reviews, edits and approves it; until then it is labelled a draft and nothing is finalised from it.",
      },
      {
        q: "What if I speak in a mix of English and Urdu?",
        a: "That is expected. The scribe is built for the way consultations are spoken in this region rather than for textbook English.",
      },
      {
        q: "Where is the audio processed?",
        a: "Audio is sent to a speech-to-text service for transcription and the text to an AI model to structure the draft. The privacy policy names the providers involved.",
      },
    ],
    related: ["patient-management", "whatsapp-integration", "appointment-management"],
  },
  {
    slug: "whatsapp-integration",
    name: "WhatsApp Integration",
    metaTitle: "WhatsApp Integration for Clinics",
    metaDescription:
      "Booking requests, confirmations, day-before reminders, rescheduling and recalls on WhatsApp — with AI replies to common questions and a staff queue.",
    eyebrow: "WhatsApp integration",
    h1: "Meet patients where they already are: WhatsApp.",
    intro:
      "In Pakistan, patients answer WhatsApp long before they answer a phone call. FlexicaAI's WhatsApp integration for clinics sends confirmations and reminders on its own, and lets patients book or reschedule simply by replying — with the diary checked before anything is promised.",
    sections: [
      {
        h2: "The whole appointment lifecycle, on WhatsApp",
        paragraphs: [
          "When an appointment is booked, the patient receives a confirmation. The day before, a reminder. If the appointment is cancelled — for example because the doctor is on leave — a cancellation notice. Prescriptions and invoice summaries can be sent the same way.",
        ],
        points: [
          "Booking confirmations",
          "Day-before reminders",
          "Cancellation notices",
          "Follow-up recalls when a visit falls due",
        ],
      },
      {
        h2: "Patients book and reschedule by replying",
        paragraphs: [
          "A patient can write \"Can I move my appointment to Friday at 5?\" and FlexicaAI understands the request, checks the doctor's hours, cap and leave, and moves the appointment if the time is free. New bookings work the same way: the patient is asked which doctor, offered that doctor's hours and given a token number for their request.",
        ],
      },
      {
        h2: "AI replies to the questions every clinic hears",
        paragraphs: [
          "Timings, location, a doctor's fee: the questions that interrupt the front desk all day can be answered by the AI assistant, which the clinic switches on. Anything it should not handle — a billing dispute, a clinical worry — goes to a staff queue for a person to answer.",
        ],
      },
      {
        h2: "One workspace for every conversation",
        paragraphs: [
          "Every patient thread sits in the clinic's WhatsApp page with its state, linked to the patient's record. The team can see what was sent automatically, what the patient replied and what still needs a human.",
        ],
      },
    ],
    steps: [
      { title: "Patient messages", text: "A booking, a reschedule or a question arrives." },
      { title: "FlexicaAI checks", text: "Doctor hours, daily caps and leave are checked first." },
      { title: "Reply or route", text: "The patient gets an answer, or the thread goes to staff." },
      { title: "Diary updates", text: "The appointment is booked or moved, and the reminder follows." },
    ],
    faqs: [
      {
        q: "Do patients need to install anything?",
        a: "No. Everything happens in WhatsApp, which patients already use every day.",
      },
      {
        q: "Can a patient stop receiving messages?",
        a: "Yes. A patient who does not want these messages can tell the clinic, which can stop them.",
      },
      {
        q: "Is this an official WhatsApp product?",
        a: "No. FlexicaAI sends and receives messages through a WhatsApp Business API provider. WhatsApp is a trademark of Meta.",
      },
    ],
    related: ["appointment-management", "patient-management", "ai-scribe"],
  },
  {
    slug: "clinic-analytics",
    name: "Clinic Analytics",
    metaTitle: "Clinic Analytics, Sales and P&L Reports",
    metaDescription:
      "Sales, collections, receivables, expenses, doctor revenue shares and profit and loss for your clinic — every report downloadable as a PDF.",
    eyebrow: "Clinic analytics",
    h1: "See what your clinic earned — and what it actually kept.",
    intro:
      "Most clinics know their busy days but not their margins. FlexicaAI turns every appointment, bill, payment and expense into reports an owner can read: sales, collections, what patients still owe, doctors' shares, expenses and a profit and loss statement.",
    sections: [
      {
        h2: "Sales from real visits, not estimates",
        paragraphs: [
          "Each completed appointment carries its procedures, services and charges, so sales reports come from what was actually done and billed. Reports break revenue down by procedure and by period, and every report downloads as a PDF.",
        ],
        points: ["Sales by procedure and period", "Collected payments", "Receivables: who owes what", "Discounts and price changes"],
      },
      {
        h2: "Doctor shares, calculated for you",
        paragraphs: [
          "Revenue shares accrue from the work each doctor does. Discounts are borne by the clinic, the doctor or both, as set on the bill, so each doctor's share reflects what was actually charged.",
        ],
      },
      {
        h2: "Expenses, petty cash and the P&L",
        paragraphs: [
          "Expenses are recorded by category. The front-desk cash drawer is reconciled at each handover, and cash spent from the drawer is recorded as an expense, so it lands in the profit and loss. The P&L brings sales, shares and expenses together into what the clinic kept.",
        ],
      },
      {
        h2: "Operational reports too",
        paragraphs: [
          "Beyond money, reports cover appointments, procedures, the daybook and no-shows — so an owner can see where the diary is leaking as well as where the revenue comes from.",
        ],
      },
    ],
    steps: [
      { title: "Treat and bill", text: "Visits carry their procedures and charges." },
      { title: "Collect", text: "Payments and deposits are recorded against invoices." },
      { title: "Record costs", text: "Expenses and petty cash are logged by category." },
      { title: "Read the P&L", text: "Sales, shares and expenses become net profit." },
    ],
    faqs: [],
    related: ["billing-and-payments", "appointment-management", "patient-management"],
  },
  {
    slug: "billing-and-payments",
    name: "Billing and Payments",
    metaTitle: "Clinic Billing and Payments Software",
    metaDescription:
      "Numbered invoices and receipts, per-line discounts with approvals, deposits and credit, and printing on thermal, A5 or A4 — billing that adds up.",
    eyebrow: "Billing and payments",
    h1: "Every rupee of the visit, on one clear bill.",
    intro:
      "FlexicaAI's clinic billing software puts the consultation, procedures, services and one-off charges of a visit on one invoice — with discounts, deposits and payments handled properly, and receipts printed on the printer your front desk already uses.",
    sections: [
      {
        h2: "One invoice for the whole visit",
        paragraphs: [
          "Procedures and services come from your clinic's price list; one-off charges can be added to any bill. Invoices and receipts are numbered, and every invoice shows what is paid and what is still due.",
        ],
        points: [
          "Procedures, services (room, X-ray, medicines) and other charges",
          "Numbered invoices and receipts",
          "Balance due shown on every invoice",
        ],
      },
      {
        h2: "Discounts that need a signature",
        paragraphs: [
          "Each line can carry its own discount, and the visit can carry an overall one. A discount can require the approval of whoever bears it — the clinic, the doctor or both — and until it is approved, the bill and the revenue figures treat it as zero.",
          "Changing a price on one bill is a separate permission the clinic admin grants per person, and every changed line is listed for review.",
        ],
      },
      {
        h2: "Payments, deposits and credit",
        paragraphs: [
          "Payments are recorded as cash, bank transfer, cheque or other. A deposit can be held against a visit until it is settled by a refund or kept as credit for the patient's next treatment. The front-desk cash drawer is reconciled at each handover.",
        ],
      },
      {
        h2: "Prints the way you already print",
        paragraphs: [
          "Invoices and receipts print on a thermal roll, A5 or A4, so the front desk keeps its printer and its habits. Treatment estimates and prescriptions print on the clinic's own letterhead.",
        ],
      },
    ],
    steps: [
      { title: "Build the bill", text: "Consultation, procedures, services and charges." },
      { title: "Apply discounts", text: "Per line or per visit, approved by whoever bears them." },
      { title: "Take payment", text: "Cash, bank transfer, cheque or a held deposit." },
      { title: "Print the receipt", text: "Thermal, A5 or A4 — your choice." },
    ],
    faqs: [
      {
        q: "Can a receptionist give a discount on their own?",
        a: "A discount can require approval from whoever bears it before it counts. Until it is approved, the bill and revenue figures behave as if it were zero.",
      },
      {
        q: "Does FlexicaAI take card or online payments?",
        a: "FlexicaAI records the payments your clinic takes — cash, bank transfer, cheque or other — and keeps the patient's balance correct. It does not process card payments itself.",
      },
      {
        q: "Will it work with our existing printer?",
        a: "Yes. Receipts and invoices print on a thermal roll, A5 or A4.",
      },
    ],
    related: ["clinic-analytics", "patient-management", "appointment-management"],
  },
];

export const getFeature = (slug: string) => FEATURES.find((f) => f.slug === slug);
