import { csvLine } from "@/core/lib/csv";
import type { ImportEntity } from "./types";

/**
 * Downloadable template definitions — CLIENT-SAFE (no server-only/DB) so the import
 * UI can build a template file to hand the clinic. Column headers match the aliases
 * the validators accept (see patients.ts / procedures.ts). docs/import-plan.md.
 */
export const IMPORT_TEMPLATES: Record<ImportEntity, { columns: string[]; sample: string[]; note: string }> = {
  patients: {
    columns: ["full_name", "phone", "age", "gender", "address", "external_ref", "opening_balance", "registered_on", "reference"],
    sample: ["Ayesha Khan", "03001234567", "32", "female", "12 Mall Rd, Lahore", "OLD-1001", "5000", "2024-03-15", "Instagram"],
    note: "full_name is required. Use age OR a date_of_birth column. external_ref = the clinic's old patient number. opening_balance = current dues in PKR. registered_on = original first-visit date.",
  },
  procedures: {
    columns: ["name", "price", "module", "is_active"],
    sample: ["Scaling & polishing", "3000", "dental", "yes"],
    note: "name is required. price in PKR. is_active yes/no (default yes).",
  },
  visits: {
    columns: ["external_ref", "patient_name", "phone", "visit_date", "doctor", "diagnosis", "treatment", "note"],
    sample: ["OLD-1001", "Ayesha Khan", "03001234567", "2024-03-15", "Dr Bilal", "Caries 26", "Composite filling on 26", "Advised soft diet; review in 2 weeks"],
    note: "Identify the patient by external_ref (old number), phone, OR exact name. visit_date is optional (defaults to today). doctor is matched to staff by name if it exists. The note text is diagnosis + treatment + note combined; at least one is required.",
  },
  // ── Financial-history archive ──
  fin_invoice: {
    columns: ["invoice_no", "invoice_date", "external_ref", "patient_name", "phone", "amount", "gross", "discount", "doctor", "description"],
    sample: ["1001", "2024-03-15", "OLD-1001", "Ayesha Khan", "03001234567", "4500", "5000", "500", "Dr Bilal", "Scaling + 1 filling"],
    note: "Old bills. Identify the patient by external_ref / phone / name (unmatched → archived unlinked). amount = NET billed (PKR); if you give gross + discount instead, net is computed. Read-only history — never enters live reports.",
  },
  fin_payment: {
    columns: ["receipt_no", "payment_date", "external_ref", "patient_name", "phone", "amount", "method", "invoice_no", "note"],
    sample: ["R-2001", "2024-03-15", "OLD-1001", "Ayesha Khan", "03001234567", "3000", "cash", "1001", "Part payment"],
    note: "Old receipts (money received). A NEGATIVE amount is recorded as a refund. Import invoices BEFORE payments. On commit you can optionally set each patient's outstanding balance from this history.",
  },
  fin_expense: {
    columns: ["expense_date", "category", "amount", "vendor", "method", "reference", "note"],
    sample: ["2024-03-01", "Rent", "80000", "Landlord", "bank", "TXN-88", "March rent"],
    note: "Old clinic expenses. amount in PKR. No patient. Read-only history.",
  },
  fin_payout: {
    columns: ["payout_date", "doctor", "amount", "method", "reference", "note"],
    sample: ["2024-03-31", "Dr Bilal", "120000", "bank", "CHQ-451", "March share"],
    note: "Old doctor payments. doctor is matched to staff by name (unmatched → archived unlinked). amount in PKR. Read-only history.",
  },
};

/**
 * A ready-to-fill CSV (header + one sample row). Uses the RFC-4180 escaper so a
 * sample value containing a comma (e.g. an address) can't shift the columns, and a
 * UTF-8 BOM so Excel opens it cleanly.
 */
export function templateCsv(entity: ImportEntity): string {
  const t = IMPORT_TEMPLATES[entity];
  return `﻿${csvLine(t.columns)}\r\n${csvLine(t.sample)}\r\n`;
}
