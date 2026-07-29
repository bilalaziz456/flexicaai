import type { ImportEntity } from "./types";

type Row = Record<string, string>;

/**
 * Column-mapping fields — CLIENT-SAFE (no server-only/DB). The canonical target
 * fields for each import entity, each with the header aliases we auto-detect. The
 * import UI renders these as "map YOUR column → this field" dropdowns; the server
 * resolves + applies the mapping before validation, so a clinic's sheet never has to
 * match our exact headers. See docs/import-plan.md.
 *
 * NOTE: a field's `key` is the canonical header the entity validators look for FIRST
 * (see patients.ts / procedures.ts / visits.ts `pick(...)`), so applying the mapping
 * (writing `row[key] = row[sourceHeader]`) makes those validators just work.
 */
export type ImportField = { key: string; label: string; required?: boolean; aliases: string[] };

export const FIELDS: Record<ImportEntity, ImportField[]> = {
  patients: [
    { key: "full_name", label: "Full name", required: true, aliases: ["full_name", "name", "patient_name", "patient"] },
    { key: "phone", label: "Phone", aliases: ["phone", "mobile", "contact", "phone_number", "whatsapp", "cell"] },
    { key: "age", label: "Age", aliases: ["age"] },
    { key: "date_of_birth", label: "Date of birth", aliases: ["date_of_birth", "dob", "birth_date", "birthdate"] },
    { key: "gender", label: "Gender", aliases: ["gender", "sex"] },
    { key: "address", label: "Address", aliases: ["address"] },
    { key: "external_ref", label: "Old patient no.", aliases: ["external_ref", "patient_id", "old_id", "file_no", "reg_no", "patient_no", "id", "mrn", "reference_no"] },
    { key: "opening_balance", label: "Opening balance", aliases: ["opening_balance", "balance", "dues", "outstanding", "due", "old_balance"] },
    { key: "registered_on", label: "Registered on", aliases: ["registered_on", "registration_date", "first_visit", "date_registered", "created_on"] },
    { key: "reference", label: "Referred by", aliases: ["reference", "referred_by", "referral", "source"] },
  ],
  procedures: [
    { key: "name", label: "Name", required: true, aliases: ["name", "procedure", "service", "treatment"] },
    { key: "price", label: "Price (PKR)", aliases: ["price", "amount", "fee", "cost", "charges", "rate"] },
    { key: "module", label: "Module", aliases: ["module", "specialty"] },
    { key: "is_active", label: "Active", aliases: ["is_active", "active", "status"] },
  ],
  visits: [
    { key: "external_ref", label: "Patient old no.", aliases: ["external_ref", "patient_id", "old_id", "file_no", "reg_no", "patient_no", "mrn"] },
    { key: "patient_name", label: "Patient name", aliases: ["patient_name", "patient", "name", "full_name"] },
    { key: "phone", label: "Patient phone", aliases: ["phone", "mobile", "contact", "whatsapp"] },
    { key: "visit_date", label: "Visit date", aliases: ["visit_date", "date", "visit", "seen_on", "visited_on"] },
    { key: "doctor", label: "Doctor", aliases: ["doctor", "doctor_name", "dentist", "provider", "physician"] },
    { key: "diagnosis", label: "Diagnosis", aliases: ["diagnosis", "dx"] },
    { key: "treatment", label: "Treatment", aliases: ["treatment", "procedure", "treatment_done", "work_done", "treatment_performed"] },
    { key: "note", label: "Note", aliases: ["note", "notes", "summary", "clinical_note", "details", "remarks", "comments"] },
  ],
  // ── Financial-history archive (docs/financial-archive-plan.md) ──
  // Old BILLS. Identify the patient by old no. / phone / name. `amount` is the NET
  // billed; if only gross+discount are given, net = gross − discount.
  fin_invoice: [
    { key: "invoice_no", label: "Invoice no.", aliases: ["invoice_no", "invoice", "bill_no", "bill", "receipt_no", "voucher_no", "ref", "reference"] },
    { key: "invoice_date", label: "Invoice date", aliases: ["invoice_date", "date", "bill_date", "issued_on", "issue_date"] },
    { key: "external_ref", label: "Patient old no.", aliases: ["external_ref", "patient_id", "old_id", "file_no", "reg_no", "patient_no", "mrn"] },
    { key: "patient_name", label: "Patient name", aliases: ["patient_name", "patient", "name", "full_name"] },
    { key: "phone", label: "Patient phone", aliases: ["phone", "mobile", "contact", "whatsapp"] },
    { key: "amount", label: "Net amount", aliases: ["amount", "net", "net_amount", "total", "grand_total", "payable", "bill_amount"] },
    { key: "gross", label: "Gross (optional)", aliases: ["gross", "gross_amount", "sub_total", "subtotal"] },
    { key: "discount", label: "Discount (optional)", aliases: ["discount", "discount_amount"] },
    { key: "doctor", label: "Doctor (optional)", aliases: ["doctor", "doctor_name", "dentist", "provider"] },
    { key: "description", label: "Description (optional)", aliases: ["description", "details", "particulars", "treatment", "service", "note", "remarks"] },
  ],
  // Old RECEIPTS (money received). A NEGATIVE amount is recorded as a refund.
  fin_payment: [
    { key: "receipt_no", label: "Receipt no.", aliases: ["receipt_no", "receipt", "voucher_no", "payment_no", "ref", "reference"] },
    { key: "payment_date", label: "Payment date", aliases: ["payment_date", "date", "paid_on", "received_on"] },
    { key: "external_ref", label: "Patient old no.", aliases: ["external_ref", "patient_id", "old_id", "file_no", "reg_no", "patient_no", "mrn"] },
    { key: "patient_name", label: "Patient name", aliases: ["patient_name", "patient", "name", "full_name"] },
    { key: "phone", label: "Patient phone", aliases: ["phone", "mobile", "contact", "whatsapp"] },
    { key: "amount", label: "Amount", aliases: ["amount", "paid", "amount_paid", "received", "payment"] },
    { key: "method", label: "Method (optional)", aliases: ["method", "mode", "payment_mode", "payment_method", "type"] },
    { key: "invoice_no", label: "Against invoice (optional)", aliases: ["invoice_no", "invoice", "bill_no", "against"] },
    { key: "note", label: "Note (optional)", aliases: ["note", "notes", "remarks", "comments"] },
  ],
  // Old clinic EXPENSES.
  fin_expense: [
    { key: "expense_date", label: "Date", aliases: ["expense_date", "date", "incurred_on", "paid_on"] },
    { key: "category", label: "Category", aliases: ["category", "head", "type", "expense_type"] },
    { key: "amount", label: "Amount", aliases: ["amount", "cost", "value", "total", "paid"] },
    { key: "vendor", label: "Vendor (optional)", aliases: ["vendor", "payee", "supplier", "paid_to"] },
    { key: "method", label: "Method (optional)", aliases: ["method", "mode", "payment_mode", "payment_method"] },
    { key: "reference", label: "Reference (optional)", aliases: ["reference", "ref", "voucher_no", "bill_no"] },
    { key: "note", label: "Note (optional)", aliases: ["note", "notes", "details", "remarks", "particulars"] },
  ],
  // Old DOCTOR PAYOUTS (money paid to a doctor).
  fin_payout: [
    { key: "payout_date", label: "Date", aliases: ["payout_date", "date", "paid_on"] },
    { key: "doctor", label: "Doctor", aliases: ["doctor", "doctor_name", "dentist", "provider", "physician", "name"] },
    { key: "amount", label: "Amount", aliases: ["amount", "paid", "payout", "value", "total"] },
    { key: "method", label: "Method (optional)", aliases: ["method", "mode", "payment_mode", "payment_method"] },
    { key: "reference", label: "Reference (optional)", aliases: ["reference", "ref", "voucher_no", "cheque_no"] },
    { key: "note", label: "Note (optional)", aliases: ["note", "notes", "details", "remarks", "period"] },
  ],
};

/** Auto-detected mapping (target field → the first matching header in the file). */
export function suggestMapping(entity: ImportEntity, headers: string[]): Record<string, string> {
  const hset = new Set(headers);
  const out: Record<string, string> = {};
  for (const f of FIELDS[entity]) {
    const hit = f.aliases.find((a) => hset.has(a));
    if (hit) out[f.key] = hit;
  }
  return out;
}

/** Auto-detection merged with the user's overrides (empty override value clears a field). */
export function resolveMapping(
  entity: ImportEntity,
  headers: string[],
  override?: Record<string, string> | null,
): Record<string, string> {
  const base = suggestMapping(entity, headers);
  if (override) {
    for (const [k, v] of Object.entries(override)) {
      if (v) base[k] = v;
      else delete base[k];
    }
  }
  return base;
}

/** Rewrite each row so the canonical field keys hold the mapped column's value. */
export function applyMapping(rows: Row[], mapping: Record<string, string>): Row[] {
  const entries = Object.entries(mapping).filter(([, src]) => src);
  if (entries.length === 0) return rows;
  return rows.map((row) => {
    const out: Row = { ...row };
    for (const [field, src] of entries) out[field] = row[src] ?? "";
    return out;
  });
}
