/**
 * The money-path vocabularies and their FIXED ids.
 *
 * This file is the contract between the database and the code. An integer surrogate
 * key is only meaningful if the same number means the same thing everywhere — a
 * `serial` assigns by insertion order, so re-seeding in a different order would
 * silently reclassify money that is already recorded (a refund becoming a payment
 * changes a P&L without raising anything). Every id is therefore written down here
 * and in the migration, and `scripts/test-vocabulary-tables.ts` asserts the database
 * agrees with this file row for row.
 *
 * Adding a value: append it with the next free id in a migration AND here. Never
 * renumber, never reuse a retired id — set `isActive: false` instead, so historical
 * rows still resolve.
 *
 * Client-safe (no server-only import): the forms need the labels, the server needs
 * the ids, and one declaration keeps them from drifting.
 */

export type VocabularyRow = {
  id: number;
  code: string;
  label: string;
  sortOrder: number;
  isActive?: boolean;
  /** `payment_methods` only — false marks a system marker, not a real tender. */
  isTender?: boolean;
};

/** `patient_payments.kind`. `opening` settles an imported pre-FlexicaAI balance. */
export const PAYMENT_KIND_ROWS = [
  { id: 1, code: "payment", label: "Payment", sortOrder: 1 },
  { id: 2, code: "advance", label: "Advance", sortOrder: 2 },
  { id: 3, code: "advance_applied", label: "Advance applied", sortOrder: 3 },
  { id: 4, code: "refund", label: "Refund", sortOrder: 4 },
  { id: 5, code: "opening", label: "Opening balance payment", sortOrder: 5 },
] as const satisfies readonly VocabularyRow[];

/** `clinic_payments.kind` — a clinic paying FlexicaAI. */
export const CLINIC_PAYMENT_KIND_ROWS = [
  { id: 1, code: "payment", label: "Payment", sortOrder: 1 },
  { id: 2, code: "refund", label: "Refund", sortOrder: 2 },
  { id: 3, code: "credit", label: "Credit", sortOrder: 3 },
] as const satisfies readonly VocabularyRow[];

/**
 * Every `method` column. `advance` is a SYSTEM marker written only by `applyAdvance`
 * — no money changes hands — so it is not a tender and never appears in a form.
 */
export const PAYMENT_METHOD_ROWS = [
  { id: 1, code: "cash", label: "Cash", sortOrder: 1, isTender: true },
  { id: 2, code: "bank", label: "Bank transfer", sortOrder: 2, isTender: true },
  { id: 3, code: "cheque", label: "Cheque", sortOrder: 3, isTender: true },
  { id: 4, code: "other", label: "Other", sortOrder: 4, isTender: true },
  { id: 5, code: "advance", label: "Advance credit", sortOrder: 5, isTender: false },
] as const satisfies readonly VocabularyRow[];

/** `doctor_settlement_actions.kind`. `reversal` is designed for, not yet written. */
export const SETTLEMENT_KIND_ROWS = [
  { id: 1, code: "doctor_waive", label: "Doctor waived own share", sortOrder: 1 },
  { id: 2, code: "clinic_waive", label: "Clinic waived (forgave debt)", sortOrder: 2 },
  { id: 3, code: "repayment", label: "Doctor repayment", sortOrder: 3 },
  { id: 4, code: "write_off", label: "Debt written off", sortOrder: 4 },
  { id: 5, code: "reversal", label: "Reversal", sortOrder: 5 },
] as const satisfies readonly VocabularyRow[];

/** `discount_settlements.party` + `appointment_discount_approvals.approver_kind`. */
export const SETTLEMENT_PARTY_ROWS = [
  { id: 1, code: "clinic", label: "Clinic", sortOrder: 1 },
  { id: 2, code: "doctor", label: "Doctor", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `appointment_discount_approvals.status` — one party's decision. */
export const APPROVAL_STATUS_ROWS = [
  { id: 1, code: "pending", label: "Pending", sortOrder: 1 },
  { id: 2, code: "approved", label: "Approved", sortOrder: 2 },
  { id: 3, code: "rejected", label: "Rejected", sortOrder: 3 },
] as const satisfies readonly VocabularyRow[];

/** `appointments.discount_status` — derived across the approval rows. */
export const DISCOUNT_STATUS_ROWS = [
  { id: 1, code: "none", label: "No approval needed", sortOrder: 1 },
  { id: 2, code: "pending", label: "Pending approval", sortOrder: 2 },
  { id: 3, code: "approved", label: "Approved", sortOrder: 3 },
  { id: 4, code: "rejected", label: "Rejected", sortOrder: 4 },
] as const satisfies readonly VocabularyRow[];

/** `discount_type` / `discount_split_type`. */
export const DISCOUNT_TYPE_ROWS = [
  { id: 1, code: "amount", label: "Flat amount", sortOrder: 1 },
  { id: 2, code: "percent", label: "Percentage", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `appointments.discount_borne_by`. */
export const DISCOUNT_BEARER_ROWS = [
  { id: 1, code: "clinic", label: "Clinic", sortOrder: 1 },
  { id: 2, code: "doctor", label: "Doctor", sortOrder: 2 },
  { id: 3, code: "split", label: "Split", sortOrder: 3 },
] as const satisfies readonly VocabularyRow[];

/** Every vocabulary, keyed by table name — what the seed and the test both walk. */
export const VOCABULARY_SEED: Record<string, readonly VocabularyRow[]> = {
  payment_kinds: PAYMENT_KIND_ROWS,
  clinic_payment_kinds: CLINIC_PAYMENT_KIND_ROWS,
  payment_methods: PAYMENT_METHOD_ROWS,
  settlement_kinds: SETTLEMENT_KIND_ROWS,
  settlement_parties: SETTLEMENT_PARTY_ROWS,
  approval_statuses: APPROVAL_STATUS_ROWS,
  discount_statuses: DISCOUNT_STATUS_ROWS,
  discount_types: DISCOUNT_TYPE_ROWS,
  discount_bearers: DISCOUNT_BEARER_ROWS,
};

/** `code → id` for one vocabulary; the lookup the write paths use. */
export function idOf(rows: readonly VocabularyRow[], code: string): number {
  const row = rows.find((r) => r.code === code);
  if (!row) throw new Error(`unknown vocabulary code: ${code}`);
  return row.id;
}

/** `id → code`, for rendering a row read back from the database. */
export function codeOf(rows: readonly VocabularyRow[], id: number | null): string | null {
  return rows.find((r) => r.id === id)?.code ?? null;
}

/**
 * Write helpers — each sets the text column AND its id together.
 *
 * The two columns coexist until the text ones are dropped, and two columns meaning
 * the same thing are exactly how drift starts (ADR-015's lesson, applied to a value
 * rather than a formula). Setting them from one call makes disagreement impossible,
 * and when the text column goes these helpers shrink to returning the id alone —
 * one edit per vocabulary rather than one per call site.
 *
 * The names encode the COLUMN each vocabulary lands on, because they differ:
 * `discount_settlements.party` and `appointment_discount_approvals.approver_kind`
 * share a vocabulary but not a column name.
 */

/** `patient_payments` — `{ kind, kindId }`. */
export function paymentKindFields(code: string) {
  return { kind: code, kindId: idOf(PAYMENT_KIND_ROWS, code) };
}

/** `clinic_payments` — `{ kind, kindId }`. */
export function clinicPaymentKindFields(code: string) {
  return { kind: code, kindId: idOf(CLINIC_PAYMENT_KIND_ROWS, code) };
}

/** Any `method` column — `{ method, methodId }`. A null method sets a null id. */
export function paymentMethodFields(code: string | null) {
  return code === null
    ? { method: null, methodId: null }
    : { method: code, methodId: idOf(PAYMENT_METHOD_ROWS, code) };
}

/** `doctor_settlement_actions` — `{ kind, kindId }`. */
export function settlementKindFields(code: string) {
  return { kind: code, kindId: idOf(SETTLEMENT_KIND_ROWS, code) };
}

/** `discount_settlements` — `{ party, partyId }`. */
export function settlementPartyFields(code: string) {
  return { party: code, partyId: idOf(SETTLEMENT_PARTY_ROWS, code) };
}

/** `appointment_discount_approvals` — `{ approverKind, approverKindId }`. */
export function approverKindFields(code: string) {
  return { approverKind: code, approverKindId: idOf(SETTLEMENT_PARTY_ROWS, code) };
}

/** `appointment_discount_approvals` — `{ status, statusId }`. */
export function approvalStatusFields(code: string) {
  return { status: code, statusId: idOf(APPROVAL_STATUS_ROWS, code) };
}

/** `appointments` — `{ discountStatus, discountStatusId }`. */
export function discountStatusFields(code: string) {
  return { discountStatus: code, discountStatusId: idOf(DISCOUNT_STATUS_ROWS, code) };
}

/** `appointments` / `appointment_procedures` — `{ discountType, discountTypeId }`. */
export function discountTypeFields(code: string) {
  return { discountType: code, discountTypeId: idOf(DISCOUNT_TYPE_ROWS, code) };
}

/** `appointments` — `{ discountSplitType, discountSplitTypeId }`. */
export function discountSplitTypeFields(code: string) {
  return { discountSplitType: code, discountSplitTypeId: idOf(DISCOUNT_TYPE_ROWS, code) };
}

/** `appointments` — `{ discountBorneBy, discountBorneById }`. */
export function discountBearerFields(code: string) {
  return { discountBorneBy: code, discountBorneById: idOf(DISCOUNT_BEARER_ROWS, code) };
}

/**
 * Typed id lookups — `paymentKindId("refund")` returns 4, and a mistyped code fails
 * to COMPILE rather than throwing at runtime, because the arrays above are literal
 * typed.
 *
 * These are what a query filters on: `eq(patientPayments.kindId, paymentKindId("refund"))`.
 * No join is needed to filter, which is the one redeeming property of a fixed
 * surrogate key — the id is a compile-time constant. Reading a value BACK for display
 * or branching uses the `*Code` functions below, also without a join.
 */
export type PaymentKindCode = (typeof PAYMENT_KIND_ROWS)[number]["code"];
export type ClinicPaymentKindCode = (typeof CLINIC_PAYMENT_KIND_ROWS)[number]["code"];
export type PaymentMethodCode = (typeof PAYMENT_METHOD_ROWS)[number]["code"];
export type SettlementKindCode = (typeof SETTLEMENT_KIND_ROWS)[number]["code"];
export type SettlementPartyCode = (typeof SETTLEMENT_PARTY_ROWS)[number]["code"];
export type ApprovalStatusCode = (typeof APPROVAL_STATUS_ROWS)[number]["code"];
export type DiscountStatusCode = (typeof DISCOUNT_STATUS_ROWS)[number]["code"];
export type DiscountTypeCode = (typeof DISCOUNT_TYPE_ROWS)[number]["code"];
export type DiscountBearerCode = (typeof DISCOUNT_BEARER_ROWS)[number]["code"];

export const paymentKindId = (c: PaymentKindCode) => idOf(PAYMENT_KIND_ROWS, c);
export const clinicPaymentKindId = (c: ClinicPaymentKindCode) => idOf(CLINIC_PAYMENT_KIND_ROWS, c);
export const paymentMethodId = (c: PaymentMethodCode) => idOf(PAYMENT_METHOD_ROWS, c);
export const settlementKindId = (c: SettlementKindCode) => idOf(SETTLEMENT_KIND_ROWS, c);
export const settlementPartyId = (c: SettlementPartyCode) => idOf(SETTLEMENT_PARTY_ROWS, c);
export const approvalStatusId = (c: ApprovalStatusCode) => idOf(APPROVAL_STATUS_ROWS, c);
export const discountStatusId = (c: DiscountStatusCode) => idOf(DISCOUNT_STATUS_ROWS, c);
export const discountTypeId = (c: DiscountTypeCode) => idOf(DISCOUNT_TYPE_ROWS, c);
export const discountBearerId = (c: DiscountBearerCode) => idOf(DISCOUNT_BEARER_ROWS, c);

/**
 * id → code, for a row read back from the database. Resolved from the constants, not
 * a join: the mapping is fixed and tiny, so paying for a join on every list query to
 * recover a string the process already knows would be pure cost.
 */
export const paymentKindCode = (id: number | null) => codeOf(PAYMENT_KIND_ROWS, id) as PaymentKindCode | null;
export const clinicPaymentKindCode = (id: number | null) => codeOf(CLINIC_PAYMENT_KIND_ROWS, id) as ClinicPaymentKindCode | null;
export const paymentMethodCode = (id: number | null) => codeOf(PAYMENT_METHOD_ROWS, id) as PaymentMethodCode | null;
export const settlementKindCode = (id: number | null) => codeOf(SETTLEMENT_KIND_ROWS, id) as SettlementKindCode | null;
export const settlementPartyCode = (id: number | null) => codeOf(SETTLEMENT_PARTY_ROWS, id) as SettlementPartyCode | null;
export const approvalStatusCode = (id: number | null) => codeOf(APPROVAL_STATUS_ROWS, id) as ApprovalStatusCode | null;
export const discountStatusCode = (id: number | null) => codeOf(DISCOUNT_STATUS_ROWS, id) as DiscountStatusCode | null;
export const discountTypeCode = (id: number | null) => codeOf(DISCOUNT_TYPE_ROWS, id) as DiscountTypeCode | null;
export const discountBearerCode = (id: number | null) => codeOf(DISCOUNT_BEARER_ROWS, id) as DiscountBearerCode | null;

/**
 * Narrow an untrusted string to a vocabulary code, or `undefined`.
 *
 * For values arriving from a URL query — a report's method or kind filter. The
 * columns are typed to their code union now, so a raw `string` cannot be compared
 * against one; and a filter for a value that does not exist should select nothing
 * rather than be passed to the database at all. Returns `undefined` for an unknown
 * value so the caller simply omits that condition.
 */
export function asCode<C extends string>(
  rows: readonly VocabularyRow[],
  value: string | null | undefined,
): C | undefined {
  if (!value) return undefined;
  return rows.some((r) => r.code === value) ? (value as C) : undefined;
}

export const asPaymentMethodCode = (v: string | null | undefined) =>
  asCode<PaymentMethodCode>(PAYMENT_METHOD_ROWS, v);
export const asPaymentKindCode = (v: string | null | undefined) =>
  asCode<PaymentKindCode>(PAYMENT_KIND_ROWS, v);

/* ────────────────────────────────────────────────────────────────────────────
 * Enum-backed vocabularies (migration `0090`).
 *
 * These were Postgres ENUM columns, which Postgres itself already enforced — so
 * unlike the money-path set the FK adds no new integrity. What it adds is a ROW per
 * value, which is what lets a label be renamed, a value reordered, or a value retired
 * without a deploy. `core/db/vocabulary-cache.ts` reads those from the database.
 *
 * The codes stay in code because the application BRANCHES on them — `nextQueueAction`
 * switches on an appointment status, `can()` on a role. A row added to the database
 * alone would be stored and then never acted on, so a NEW value is still a code
 * change. The database owns how a value is PRESENTED; the code owns what it MEANS.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `appointments.status` — the live-queue lifecycle. Order is the flow itself. */
export const APPOINTMENT_STATUS_ROWS = [
  { id: 1, code: "scheduled", label: "Scheduled", sortOrder: 1 },
  { id: 2, code: "confirmed", label: "Confirmed", sortOrder: 2 },
  { id: 3, code: "arrived", label: "Arrived", sortOrder: 3 },
  { id: 4, code: "in_progress", label: "In progress", sortOrder: 4 },
  { id: 5, code: "completed", label: "Completed", sortOrder: 5 },
  { id: 6, code: "cancelled", label: "Cancelled", sortOrder: 6 },
  { id: 7, code: "no_show", label: "No-show", sortOrder: 7 },
] as const satisfies readonly VocabularyRow[];

/** `visits.status` — `transcribing` and `failed` are the async-scribe states (ADR-020). */
export const VISIT_STATUS_ROWS = [
  { id: 1, code: "transcribing", label: "Transcribing", sortOrder: 1 },
  { id: 2, code: "draft", label: "Draft", sortOrder: 2 },
  { id: 3, code: "approved", label: "Approved", sortOrder: 3 },
  { id: 4, code: "failed", label: "Failed", sortOrder: 4 },
] as const satisfies readonly VocabularyRow[];

/** `recalls.status`. */
export const RECALL_STATUS_ROWS = [
  { id: 1, code: "pending", label: "Pending", sortOrder: 1 },
  { id: 2, code: "scheduled", label: "Scheduled", sortOrder: 2 },
  { id: 3, code: "sent", label: "Sent", sortOrder: 3 },
  { id: 4, code: "booked", label: "Booked", sortOrder: 4 },
  { id: 5, code: "completed", label: "Completed", sortOrder: 5 },
  { id: 6, code: "cancelled", label: "Cancelled", sortOrder: 6 },
] as const satisfies readonly VocabularyRow[];

/** `users.role`. `super_admin` is the company's own staff, not a clinic's. */
export const USER_ROLE_ROWS = [
  { id: 1, code: "super_admin", label: "Super admin", sortOrder: 1 },
  { id: 2, code: "clinic_admin", label: "Clinic admin", sortOrder: 2 },
  { id: 3, code: "manager", label: "Manager", sortOrder: 3 },
  { id: 4, code: "doctor", label: "Doctor", sortOrder: 4 },
  { id: 5, code: "receptionist", label: "Receptionist", sortOrder: 5 },
] as const satisfies readonly VocabularyRow[];

/** `users.theme`. */
export const THEME_PREFERENCE_ROWS = [
  { id: 1, code: "system", label: "System", sortOrder: 1 },
  { id: 2, code: "light", label: "Light", sortOrder: 2 },
  { id: 3, code: "dark", label: "Dark", sortOrder: 3 },
] as const satisfies readonly VocabularyRow[];

/** `whatsapp_messages.direction`. */
export const WHATSAPP_DIRECTION_ROWS = [
  { id: 1, code: "inbound", label: "Inbound", sortOrder: 1 },
  { id: 2, code: "outbound", label: "Outbound", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `whatsapp_messages.status` — the provider's delivery receipt states. */
export const WHATSAPP_STATUS_ROWS = [
  { id: 1, code: "queued", label: "Queued", sortOrder: 1 },
  { id: 2, code: "sent", label: "Sent", sortOrder: 2 },
  { id: 3, code: "delivered", label: "Delivered", sortOrder: 3 },
  { id: 4, code: "read", label: "Read", sortOrder: 4 },
  { id: 5, code: "failed", label: "Failed", sortOrder: 5 },
  { id: 6, code: "received", label: "Received", sortOrder: 6 },
] as const satisfies readonly VocabularyRow[];

/**
 * `whatsapp_messages.intent` — what the assistant decided an INBOUND message was
 * asking for (`core/ai/chat-engine`). NULL on outbound, and on inbound the assistant
 * never classified (feature off, rate limited, or the deterministic handler took it).
 *
 * Stored for one reason: `clinical` is recorded rather than merged into `other`, so
 * there is eventually a real number for how often patients ask clinical questions.
 * That number is what decides whether triage is ever worth building — see
 * docs/whatsapp-ai-plan.md. Without it the question is unanswerable.
 */
export const CHAT_INTENT_ROWS = [
  { id: 1, code: "book", label: "Booking", sortOrder: 1 },
  { id: 2, code: "reschedule", label: "Reschedule", sortOrder: 2 },
  { id: 3, code: "cancel", label: "Cancellation", sortOrder: 3 },
  { id: 4, code: "price", label: "Price question", sortOrder: 4 },
  { id: 5, code: "clinical", label: "Clinical question", sortOrder: 5 },
  { id: 6, code: "other", label: "Other", sortOrder: 6 },
  { id: 7, code: "fee", label: "Consultation fee question", sortOrder: 7 },
  { id: 8, code: "hours", label: "Timings question", sortOrder: 8 },
] as const satisfies readonly VocabularyRow[];

export type AppointmentStatusCode = (typeof APPOINTMENT_STATUS_ROWS)[number]["code"];
export type VisitStatusCode = (typeof VISIT_STATUS_ROWS)[number]["code"];
export type RecallStatusCode = (typeof RECALL_STATUS_ROWS)[number]["code"];
export type UserRoleCode = (typeof USER_ROLE_ROWS)[number]["code"];
export type ThemePreferenceCode = (typeof THEME_PREFERENCE_ROWS)[number]["code"];
export type WhatsappDirectionCode = (typeof WHATSAPP_DIRECTION_ROWS)[number]["code"];
export type WhatsappStatusCode = (typeof WHATSAPP_STATUS_ROWS)[number]["code"];
export type ChatIntentCode = (typeof CHAT_INTENT_ROWS)[number]["code"];

/** Added to `VOCABULARY_SEED` below so the seed, the cache and the test walk one list. */
const ENUM_VOCABULARY_SEED: Record<string, readonly VocabularyRow[]> = {
  appointment_statuses: APPOINTMENT_STATUS_ROWS,
  visit_statuses: VISIT_STATUS_ROWS,
  recall_statuses: RECALL_STATUS_ROWS,
  user_roles: USER_ROLE_ROWS,
  theme_preferences: THEME_PREFERENCE_ROWS,
  whatsapp_directions: WHATSAPP_DIRECTION_ROWS,
  whatsapp_statuses: WHATSAPP_STATUS_ROWS,
  chat_intents: CHAT_INTENT_ROWS,
};

/**
 * EVERY vocabulary table — the money-path set plus the enum-backed set. The seed, the
 * runtime cache and the consistency test all walk this one list, so a vocabulary added
 * to the codebase but forgotten in one of the three is impossible.
 */


/** Typed id lookups for the enum-backed vocabularies (migration `0090`). */
export const appointmentStatusId = (c: AppointmentStatusCode) => idOf(APPOINTMENT_STATUS_ROWS, c);
export const visitStatusId = (c: VisitStatusCode) => idOf(VISIT_STATUS_ROWS, c);
export const recallStatusId = (c: RecallStatusCode) => idOf(RECALL_STATUS_ROWS, c);
export const userRoleId = (c: UserRoleCode) => idOf(USER_ROLE_ROWS, c);
export const themePreferenceId = (c: ThemePreferenceCode) => idOf(THEME_PREFERENCE_ROWS, c);
export const whatsappDirectionId = (c: WhatsappDirectionCode) => idOf(WHATSAPP_DIRECTION_ROWS, c);
export const whatsappStatusId = (c: WhatsappStatusCode) => idOf(WHATSAPP_STATUS_ROWS, c);
export const chatIntentId = (c: ChatIntentCode) => idOf(CHAT_INTENT_ROWS, c);

/* ────────────────────────────────────────────────────────────────────────────
 * The remaining free-text vocabularies (migration `0092`).
 *
 * These had NOTHING guarding them — no enum, no CHECK, no FK — so unlike the enum set
 * the FK is real integrity here; and unlike the money-path set a bad value's worst
 * case was cosmetic rather than a wrong figure, which is why they came last.
 *
 * `appointments.source` is included because it does drive behaviour: `whatsapp` marks
 * a patient self-booking that stays a request until staff confirm it.
 * ──────────────────────────────────────────────────────────────────────────── */

/** `clinics.status` — the subscription lifecycle. */
export const CLINIC_STATUS_ROWS = [
  { id: 1, code: "trial", label: "Trial", sortOrder: 1 },
  { id: 2, code: "active", label: "Active", sortOrder: 2 },
  { id: 3, code: "suspended", label: "Suspended", sortOrder: 3 },
  { id: 4, code: "past_due", label: "Past due", sortOrder: 4 },
  { id: 5, code: "cancelled", label: "Cancelled", sortOrder: 5 },
] as const satisfies readonly VocabularyRow[];

/** `clinics.billing_cycle` — the subscription package. */
export const BILLING_CYCLE_ROWS = [
  { id: 1, code: "monthly", label: "Monthly", sortOrder: 1 },
  { id: 2, code: "2m", label: "2-monthly", sortOrder: 2 },
  { id: 3, code: "quarter", label: "Quarterly", sortOrder: 3 },
  { id: 4, code: "half", label: "Half-yearly", sortOrder: 4 },
  { id: 5, code: "annual", label: "Annual", sortOrder: 5 },
] as const satisfies readonly VocabularyRow[];

/** `clinics.invoice_paper` — the default print size. */
export const INVOICE_PAPER_ROWS = [
  { id: 1, code: "thermal", label: "Thermal", sortOrder: 1 },
  { id: 2, code: "a5", label: "A5", sortOrder: 2 },
  { id: 3, code: "a4", label: "A4", sortOrder: 3 },
] as const satisfies readonly VocabularyRow[];

/** `treatment_plans.status`. */
export const TREATMENT_PLAN_STATUS_ROWS = [
  { id: 1, code: "proposed", label: "Proposed", sortOrder: 1 },
  { id: 2, code: "active", label: "Active", sortOrder: 2 },
  { id: 3, code: "completed", label: "Completed", sortOrder: 3 },
  { id: 4, code: "cancelled", label: "Cancelled", sortOrder: 4 },
] as const satisfies readonly VocabularyRow[];

/** `treatment_plan_items.status`. */
export const TREATMENT_ITEM_STATUS_ROWS = [
  { id: 1, code: "planned", label: "Planned", sortOrder: 1 },
  { id: 2, code: "in_progress", label: "In progress", sortOrder: 2 },
  { id: 3, code: "done", label: "Done", sortOrder: 3 },
  { id: 4, code: "cancelled", label: "Cancelled", sortOrder: 4 },
] as const satisfies readonly VocabularyRow[];

/** `clinical_attachments.kind`. Photo consent gates `photo` server-side. */
export const ATTACHMENT_KIND_ROWS = [
  { id: 1, code: "xray", label: "X-ray", sortOrder: 1 },
  { id: 2, code: "photo", label: "Photo", sortOrder: 2 },
  { id: 3, code: "document", label: "Document", sortOrder: 3 },
  { id: 4, code: "consent", label: "Consent form", sortOrder: 4 },
] as const satisfies readonly VocabularyRow[];

/** `import_batches.status`. */
export const IMPORT_BATCH_STATUS_ROWS = [
  { id: 1, code: "active", label: "Active", sortOrder: 1 },
  { id: 2, code: "undone", label: "Undone", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `announcements.level`. */
export const ANNOUNCEMENT_LEVEL_ROWS = [
  { id: 1, code: "info", label: "Info", sortOrder: 1 },
  { id: 2, code: "warning", label: "Warning", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `ai_usage.provider`. NOT `ai_usage.model`, which is an open vocabulary. */
export const AI_PROVIDER_ROWS = [
  { id: 1, code: "whisper", label: "Whisper", sortOrder: 1 },
  { id: 2, code: "claude", label: "Claude", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `platform_cost_rates.tax_mode`. */
export const TAX_MODE_ROWS = [
  { id: 1, code: "itemized", label: "Itemised", sortOrder: 1 },
  { id: 2, code: "total", label: "Single total", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `expenses.recurrence` and `company_expenses.recurrence` — both nullable. */
export const RECURRENCE_ROWS = [
  { id: 1, code: "monthly", label: "Monthly", sortOrder: 1 },
  { id: 2, code: "weekly", label: "Weekly", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

/** `appointments.source`. */
export const APPOINTMENT_SOURCE_ROWS = [
  { id: 1, code: "staff", label: "Staff", sortOrder: 1 },
  { id: 2, code: "whatsapp", label: "WhatsApp", sortOrder: 2 },
] as const satisfies readonly VocabularyRow[];

export type ClinicStatusCode = (typeof CLINIC_STATUS_ROWS)[number]["code"];
export type BillingCycleCode = (typeof BILLING_CYCLE_ROWS)[number]["code"];
export type InvoicePaperCode = (typeof INVOICE_PAPER_ROWS)[number]["code"];
export type TreatmentPlanStatusCode = (typeof TREATMENT_PLAN_STATUS_ROWS)[number]["code"];
export type TreatmentItemStatusCode = (typeof TREATMENT_ITEM_STATUS_ROWS)[number]["code"];
export type AttachmentKindCode = (typeof ATTACHMENT_KIND_ROWS)[number]["code"];
export type ImportBatchStatusCode = (typeof IMPORT_BATCH_STATUS_ROWS)[number]["code"];
export type AnnouncementLevelCode = (typeof ANNOUNCEMENT_LEVEL_ROWS)[number]["code"];
export type AiProviderCode = (typeof AI_PROVIDER_ROWS)[number]["code"];
export type TaxModeCode = (typeof TAX_MODE_ROWS)[number]["code"];
export type RecurrenceCode = (typeof RECURRENCE_ROWS)[number]["code"];
export type AppointmentSourceCode = (typeof APPOINTMENT_SOURCE_ROWS)[number]["code"];

export const clinicStatusId = (c: ClinicStatusCode) => idOf(CLINIC_STATUS_ROWS, c);
export const billingCycleId = (c: BillingCycleCode) => idOf(BILLING_CYCLE_ROWS, c);
export const invoicePaperId = (c: InvoicePaperCode) => idOf(INVOICE_PAPER_ROWS, c);
export const treatmentPlanStatusId = (c: TreatmentPlanStatusCode) => idOf(TREATMENT_PLAN_STATUS_ROWS, c);
export const treatmentItemStatusId = (c: TreatmentItemStatusCode) => idOf(TREATMENT_ITEM_STATUS_ROWS, c);
export const attachmentKindId = (c: AttachmentKindCode) => idOf(ATTACHMENT_KIND_ROWS, c);
export const importBatchStatusId = (c: ImportBatchStatusCode) => idOf(IMPORT_BATCH_STATUS_ROWS, c);
export const announcementLevelId = (c: AnnouncementLevelCode) => idOf(ANNOUNCEMENT_LEVEL_ROWS, c);
export const aiProviderId = (c: AiProviderCode) => idOf(AI_PROVIDER_ROWS, c);
export const taxModeId = (c: TaxModeCode) => idOf(TAX_MODE_ROWS, c);
export const recurrenceId = (c: RecurrenceCode) => idOf(RECURRENCE_ROWS, c);
export const appointmentSourceId = (c: AppointmentSourceCode) => idOf(APPOINTMENT_SOURCE_ROWS, c);

const FREE_TEXT_VOCABULARY_SEED: Record<string, readonly VocabularyRow[]> = {
  clinic_statuses: CLINIC_STATUS_ROWS,
  billing_cycles: BILLING_CYCLE_ROWS,
  invoice_papers: INVOICE_PAPER_ROWS,
  treatment_plan_statuses: TREATMENT_PLAN_STATUS_ROWS,
  treatment_item_statuses: TREATMENT_ITEM_STATUS_ROWS,
  attachment_kinds: ATTACHMENT_KIND_ROWS,
  import_batch_statuses: IMPORT_BATCH_STATUS_ROWS,
  announcement_levels: ANNOUNCEMENT_LEVEL_ROWS,
  ai_providers: AI_PROVIDER_ROWS,
  tax_modes: TAX_MODE_ROWS,
  recurrences: RECURRENCE_ROWS,
  appointment_sources: APPOINTMENT_SOURCE_ROWS,
};

/**
 * EVERY vocabulary table. The seed, the runtime cache and the consistency test all
 * walk this one list, so a vocabulary added to the codebase but forgotten in one of
 * the three is impossible.
 */
export const ALL_VOCABULARY_SEED: Record<string, readonly VocabularyRow[]> = {
  ...VOCABULARY_SEED,
  ...ENUM_VOCABULARY_SEED,
  ...FREE_TEXT_VOCABULARY_SEED,
};

/**
 * Code TUPLES, for `z.enum(...)`.
 *
 * zod needs a non-empty readonly tuple of literals, which `rows.map(...)` cannot give
 * it — the map widens to `string[]`. These are the derived form the actions use, so a
 * zod schema never restates a vocabulary (`scripts/test-vocabulary-tables.ts` fails if
 * one does).
 */
const codesOf = <T extends readonly VocabularyRow[]>(rows: T) =>
  rows.map((r) => r.code) as unknown as {
    [K in keyof T]: T[K] extends { code: infer C } ? C : never;
  };

export const CHAT_INTENT_CODES = codesOf(CHAT_INTENT_ROWS);
export const PAYMENT_METHOD_CODES = codesOf(PAYMENT_METHOD_ROWS);
export const PAYMENT_KIND_CODES = codesOf(PAYMENT_KIND_ROWS);
export const CLINIC_PAYMENT_KIND_CODES = codesOf(CLINIC_PAYMENT_KIND_ROWS);
export const SETTLEMENT_KIND_CODES = codesOf(SETTLEMENT_KIND_ROWS);
export const DISCOUNT_TYPE_CODES = codesOf(DISCOUNT_TYPE_ROWS);
export const DISCOUNT_BEARER_CODES = codesOf(DISCOUNT_BEARER_ROWS);
export const BILLING_CYCLE_CODES = codesOf(BILLING_CYCLE_ROWS);
export const CLINIC_STATUS_CODES = codesOf(CLINIC_STATUS_ROWS);
export const INVOICE_PAPER_CODES = codesOf(INVOICE_PAPER_ROWS);

export const ANNOUNCEMENT_LEVEL_CODES = codesOf(ANNOUNCEMENT_LEVEL_ROWS);
export const TAX_MODE_CODES = codesOf(TAX_MODE_ROWS);
export const RECURRENCE_CODES = codesOf(RECURRENCE_ROWS);
export const APPROVAL_STATUS_CODES = codesOf(APPROVAL_STATUS_ROWS);
export const ATTACHMENT_KIND_CODES = codesOf(ATTACHMENT_KIND_ROWS);

/**
 * Legitimate SUBSETS of a vocabulary — derived by EXCLUSION so they cannot drift.
 *
 * A hardcoded subset looks harmless but silently stops covering its parent the moment
 * the parent gains a value. Excluding the one code that does not belong keeps the two
 * in step and states WHY it is excluded.
 */

/** What an approver may CHOOSE — `pending` is the starting state, not a decision. */
export const APPROVAL_DECISION_CODES = APPROVAL_STATUS_ROWS.filter(
  (r) => r.code !== "pending",
).map((r) => r.code) as unknown as ["approved", "rejected"];

/** What a user may RECORD — `reversal` is written by the void path, never chosen. */
export const SETTLEMENT_ACTION_CODES = SETTLEMENT_KIND_ROWS.filter(
  (r) => r.code !== "reversal",
).map((r) => r.code) as unknown as ["doctor_waive", "clinic_waive", "repayment", "write_off"];
