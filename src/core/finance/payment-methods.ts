/**
 * Payment methods — CORE, specialty-agnostic. The single source of truth for the
 * list of methods, their display labels, and how a stored value is normalised.
 *
 * Client-safe (no server-only imports) so the forms, the filters, the zod schemas
 * and the day-book aggregation all read the same list. Before this module the four
 * values were re-declared in twelve places — two `METHODS` arrays, a zod enum in a
 * different order, three filter option lists and six hardcoded `<option>` blocks —
 * and they had already drifted: `bank` rendered as "Bank transfer" on five screens
 * and "Bank" on two.
 *
 * The DB stores the chosen value per row (`patient_payments.method`,
 * `expenses.method`, `doctor_payouts.method`, `clinic_payments.method`,
 * `company_expenses.method`); this module only says which values are allowed.
 *
 * `imported_transactions.method` is deliberately NOT bound by this list — it
 * archives whatever a clinic's previous system wrote, verbatim.
 */

export const PAYMENT_METHODS = ["cash", "bank", "cheque", "other"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

/** `{ value, label }` options for a `<select>` or a SearchableSelect. */
export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] =
  PAYMENT_METHODS.map((value) => ({ value, label: PAYMENT_METHOD_LABEL[value] }));

const SYSTEM_METHOD_LABEL: Record<SystemPaymentMethod, string> = {
  advance: "Advance credit",
};

/**
 * Label for a method string straight off a DB row. Safe for untyped/legacy values:
 * imported history and rows written before this list existed may hold anything, so
 * an unknown value renders as itself rather than blank.
 */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return (
    PAYMENT_METHOD_LABEL[method as PaymentMethod] ??
    SYSTEM_METHOD_LABEL[method as SystemPaymentMethod] ??
    method
  );
}

/**
 * Fold any stored value into a known method — for GROUPING (the day book totals by
 * method, so an unrecognised value must land somewhere rather than create a stray
 * row). Display uses `paymentMethodLabel`, which preserves the original.
 */
export function normalizePaymentMethod(method: string | null | undefined): PaymentMethod {
  return PAYMENT_METHODS.includes(method as PaymentMethod)
    ? (method as PaymentMethod)
    : "other";
}

/** Sort key for the canonical method order (cash first). Unknown values sort last. */
export function paymentMethodOrder(method: string): number {
  const i = PAYMENT_METHODS.indexOf(method as PaymentMethod);
  return i === -1 ? PAYMENT_METHODS.length : i;
}

/**
 * Methods the APP writes that are never offered in a form. `advance` marks a row paid
 * out of the patient's stored credit (`applyAdvance`) — no tender changed hands, so it
 * is not a choice a receptionist can make, but it IS a value the column legitimately
 * holds and every stored-value check must allow it.
 *
 * Kept out of `PAYMENT_METHODS` deliberately: that list drives the dropdowns and the
 * zod schemas, and offering "Advance credit" as a tender would let someone record a
 * payment from credit without the balance arithmetic `applyAdvance` performs.
 */
export const SYSTEM_PAYMENT_METHODS = ["advance"] as const;

export type SystemPaymentMethod = (typeof SYSTEM_PAYMENT_METHODS)[number];

/**
 * Every value `patient_payments.method` may hold — the tenders plus the system markers.
 * This is what the DB CHECK constraint mirrors. The other `method` columns
 * (expenses, payouts, clinic and company payments) allow tenders only: nothing writes a
 * system marker to them.
 */
export const STORED_PAYMENT_METHODS = [
  ...PAYMENT_METHODS,
  ...SYSTEM_PAYMENT_METHODS,
] as const;
