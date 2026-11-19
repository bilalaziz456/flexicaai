/**
 * "Send on WhatsApp" from an appointment (2026-11-20): the message and the wa.me link.
 * Pure — no database.
 *   npx tsx --tsconfig scripts/_seed/tsconfig.json scripts/test-whatsapp-share.ts
 */
import { appointmentWhatsAppText, invoiceWhatsAppText, planWhatsAppText, prescriptionWhatsAppText, whatsAppChatUrl } from "@/core/appointments/whatsapp-share";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${!cond && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

const full = appointmentWhatsAppText({
  patientName: "Ali Khan",
  clinicName: "Smile Care",
  when: "20 Nov 2026, 09:00 AM",
  queueNumber: 7,
  doctor: "Dr. Faisal Karim",
  bill: { invoice: "INV-100399", total: "Rs 3,500", paid: "Rs 1,000", due: "Rs 2,500" },
  contact: "Gulberg, Lahore · 03001234567",
});
ok("greets the patient", full.startsWith("Dear Ali Khan,"));
ok("says when, the number and the doctor", full.includes("Date: 20 Nov 2026, 09:00 AM") && full.includes("Appointment no.: 7") && full.includes("Doctor: Dr. Faisal Karim"));
ok("the bill, with its invoice", full.includes("Invoice INV-100399") && full.includes("Due: Rs 2,500"));
ok("closes with the clinic and its contact", full.endsWith("Smile Care\nGulberg, Lahore · 03001234567"));

const bare = appointmentWhatsAppText({ patientName: "Sara", clinicName: "C", when: "x", queueNumber: null, doctor: null });
ok("no number, doctor or bill → those lines are left out", !bare.includes("Appointment no.") && !bare.includes("Doctor:") && !bare.includes("Total"), bare);

const url = whatsAppChatUrl("+923450186120", "Hi & bye\nnext");
ok("the patient's number, digits only", url.startsWith("https://wa.me/923450186120?text="), url);
ok("the text is encoded (& and new lines)", url.endsWith("Hi%20%26%20bye%0Anext"), url);
ok("no number → WhatsApp asks for the chat", whatsAppChatUrl(null, "x") === "https://wa.me/?text=x");

const party = { patientName: "Ali Khan", phone: "+923450186120", clinicName: "Smile Care", contact: "03001234567" };
const rx = prescriptionWhatsAppText(party, {
  date: "20 Nov 2026",
  doctor: "Dr. Faisal Karim",
  lines: ["Augmentin 625mg · 1+0+1 · 5 days", "Panadol · when needed"],
  notes: "Soft food for two days",
});
ok("prescription: numbered medicines", rx.includes("1. Augmentin 625mg · 1+0+1 · 5 days") && rx.includes("2. Panadol · when needed"), rx);
ok(
  "prescription: date, doctor, notes, clinic",
  rx.includes("(20 Nov 2026)") && rx.includes("Doctor: Dr. Faisal Karim") && rx.includes("Notes: Soft food") && rx.endsWith("Smile Care\n03001234567"),
  rx,
);
const plan = planWhatsAppText(party, {
  title: "Upper molars",
  doctor: null,
  items: [{ name: "Root canal (16)", amount: "Rs 15,000" }, { name: "Crown (16)", amount: "Rs 12,000" }],
  total: "Rs 27,000",
  note: null,
});
ok("plan: each treatment, then the total", plan.includes("• Root canal (16) — Rs 15,000") && plan.includes("Total: Rs 27,000") && !plan.includes("Doctor:"), plan);

const inv = invoiceWhatsAppText(
  { patientName: "Ali Khan", clinicName: "Smile Care", contact: null },
  { invoice: "INV-100399", date: "20 Nov 2026", total: "Rs 3,500", paid: "Rs 1,000", due: "Rs 2,500" },
);
ok("invoice: the bill, no appointment number or doctor", inv.includes("Invoice no.: INV-100399") && inv.includes("Due: Rs 2,500") && !inv.includes("Appointment no.") && !inv.includes("Doctor:"), inv);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
