import { integer, pgTable, text, boolean, index } from "drizzle-orm/pg-core";

/**
 * Reference tables for the money-path vocabularies — the values a payment, a
 * settlement or a discount can take. Company-global: no `clinic_id`, so the tenant
 * guard ignores them, and a clinic cannot invent its own.
 *
 * **Ids are ASSIGNED EXPLICITLY, never by a sequence.** A surrogate key only works if
 * the same number means the same thing in dev, staging and production; a `serial`
 * assigns by insertion order, so a re-seed in a different order would silently
 * reclassify money that has already been recorded. Every row's id is written out in
 * the migration and in `VOCABULARY_SEED` below, and a new value takes the next free
 * number in a migration — never by inserting and hoping.
 *
 * The `code` column is what the app and every human still read; the id exists to give
 * the referencing tables a foreign key. Both are unique, so either is a safe join key.
 *
 * WHAT A FOREIGN KEY CANNOT DO, and where that matters: it enforces "this value exists
 * in the table", not "this value is in a SUBSET of the table". `payment_methods` holds
 * the four tenders plus the system marker `advance` (written only by `applyAdvance`
 * when a bill is settled from stored credit). The CHECK constraints this replaces kept
 * `advance` out of the four non-patient method columns; an FK cannot, so that
 * restriction now lives in zod alone (`core/finance/payment-methods.ts` —
 * `PAYMENT_METHODS` for forms, `STORED_PAYMENT_METHODS` for what a column may hold).
 */

/** Columns every vocabulary table shares. */
const vocabularyColumns = () => ({
  // Explicit, never serial — see the note above.
  id: integer("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Hidden from new entry, kept so historical rows still resolve. */
  isActive: boolean("is_active").notNull().default(true),
});

/** `patient_payments.kind` — how a patient's money-in row is classified. */
export const paymentKinds = pgTable("payment_kinds", {
  ...vocabularyColumns(),
});

/** `clinic_payments.kind` — a clinic's subscription payment to FlexicaAI. */
export const clinicPaymentKinds = pgTable("clinic_payment_kinds", {
  ...vocabularyColumns(),
});

/**
 * Every `method` column. `isTender` marks a real means of payment; `advance` is a
 * SYSTEM marker (credit consumed, no money moved) and is deliberately false, so the
 * forms can offer tenders only while the column may still hold it.
 */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    ...vocabularyColumns(),
    isTender: boolean("is_tender").notNull().default(true),
  },
  (t) => [index("payment_methods_tender_idx").on(t.isTender)],
);

/** `doctor_settlement_actions.kind` — the manual moves on a doctor's share balance. */
export const settlementKinds = pgTable("settlement_kinds", {
  ...vocabularyColumns(),
});

/**
 * `discount_settlements.party` and `appointment_discount_approvals.approver_kind` —
 * the two sides of a zero-sum transfer. One table because it is one vocabulary: a
 * third value would break the netting in both places identically.
 */
export const settlementParties = pgTable("settlement_parties", {
  ...vocabularyColumns(),
});

/** `appointment_discount_approvals.status` — one party's decision. */
export const approvalStatuses = pgTable("approval_statuses", {
  ...vocabularyColumns(),
});

/**
 * `appointments.discount_status` — the appointment's DERIVED state across its
 * approval rows. Kept separate from `approval_statuses` even though three values
 * overlap: only this one has `none` ("nobody needs to approve"), and merging them
 * would let an approval row be created in a state that means nothing for a party.
 */
export const discountStatuses = pgTable("discount_statuses", {
  ...vocabularyColumns(),
});

/** `discount_type` / `discount_split_type` — flat rupees, or a percentage. */
export const discountTypes = pgTable("discount_types", {
  ...vocabularyColumns(),
});

/** `appointments.discount_borne_by` — who absorbs a discount in the doctor split. */
export const discountBearers = pgTable("discount_bearers", {
  ...vocabularyColumns(),
});

export type PaymentKindRow = typeof paymentKinds.$inferSelect;
export type ClinicPaymentKindRow = typeof clinicPaymentKinds.$inferSelect;
export type PaymentMethodRow = typeof paymentMethods.$inferSelect;
export type SettlementKindRow = typeof settlementKinds.$inferSelect;
export type SettlementPartyRow = typeof settlementParties.$inferSelect;
export type ApprovalStatusRow = typeof approvalStatuses.$inferSelect;
export type DiscountStatusRow = typeof discountStatuses.$inferSelect;
export type DiscountTypeRow = typeof discountTypes.$inferSelect;
export type DiscountBearerRow = typeof discountBearers.$inferSelect;

/**
 * A reference to one of the vocabulary tables above: an INTEGER column carrying the
 * foreign key, presented to TypeScript as the readable `code`.
 *
 * WHY THE INDIRECTION, rather than exposing the id: the database gets what a lookup
 * table is for — a real `integer` column, a real FK, and a value that cannot exist
 * unless the vocabulary row does. The application keeps writing
 * `eq(patientPayments.kind, "refund")` and reading `row.kind === "refund"`, so the
 * ~120 places that filter, aggregate, label and branch on these values did not have
 * to be rewritten by hand. Rewriting them was the single largest risk in this change:
 * every one of them is money arithmetic or a money report, and a mistake there
 * produces a wrong figure rather than an error.
 *
 * `toDriver` throws on a code that is not seeded, so a typo fails loudly at the write
 * rather than being stored as something else. `fromDriver` resolves from the same
 * constants, never a join — the mapping is nine tiny fixed tables, and paying for a
 * join on every list query to recover a string the process already holds would be
 * pure cost.
 *
 * The generated SQL is `kind_id = 4`, not `kind = 'refund'` — that readability is
 * genuinely lost at the psql prompt, which is the trade this design makes. Joining
 * `payment_kinds` gets the label back when a human is reading.
 */
import { customType } from "drizzle-orm/pg-core";
import { codeOf, idOf, type VocabularyRow } from "@/core/db/vocabulary-seed";

export function vocabularyRef<Code extends string>(
  rows: readonly VocabularyRow[],
  name: string,
) {
  return customType<{ data: Code; driverData: number; notNull: false }>({
    dataType: () => "integer",
    toDriver: (code: Code) => idOf(rows, code),
    fromDriver: (id: number) => {
      const code = codeOf(rows, id);
      // Unreachable through the FK, but a NULL or a hand-edited row would otherwise
      // surface as `undefined` and be silently treated as "no discount", "not a
      // refund" — a wrong figure rather than a failure.
      if (code === null) throw new Error(`${name}: unknown id ${id}`);
      return code as Code;
    },
  })(name);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Enum-backed vocabularies (migration `0090`).
 *
 * These columns were Postgres ENUMs, which Postgres already enforced — so the FK adds
 * no integrity here. What it adds is a ROW per value, which is what lets a label,
 * ordering or retirement be changed without a deploy (`core/db/vocabulary-cache.ts`).
 * ──────────────────────────────────────────────────────────────────────────── */

/** `appointments.status` — the live-queue lifecycle. */
export const appointmentStatuses = pgTable("appointment_statuses", {
  ...vocabularyColumns(),
});

/** `visits.status` — includes the async-scribe states (ADR-020). */
export const visitStatuses = pgTable("visit_statuses", { ...vocabularyColumns() });

/** `recalls.status`. */
export const recallStatuses = pgTable("recall_statuses", { ...vocabularyColumns() });

/** `users.role`. */
export const userRoles = pgTable("user_roles", { ...vocabularyColumns() });

/** `users.theme`. */
export const themePreferences = pgTable("theme_preferences", { ...vocabularyColumns() });

/** `whatsapp_messages.direction`. */
export const whatsappDirections = pgTable("whatsapp_directions", { ...vocabularyColumns() });

/** `whatsapp_messages.status` — the provider's delivery receipt states. */
export const whatsappStatuses = pgTable("whatsapp_statuses", { ...vocabularyColumns() });
