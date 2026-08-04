# Data import / clinic onboarding — plan

How a new clinic's existing data gets into FlexicaAI. Owner/super-admin-run, gated by a
new admin capability. Built in phases so a clinic is usable fast.

> Status: **Phases 1 & 2 BUILT.** Phase 1 = patients + procedures + opening balances
> (migration `0067`). Phase 2 = clinical-notes history — freeform, imported, approved
> `visits` with patient (external_ref → phone → name) + doctor-by-name matching,
> rendered in the clinical timeline with an "Imported" badge (migration `0068`).
> Opening balances are now **settleable** — a `Settle opening balance` form on the
> patient's Account card records an `opening` payment (billing:create) that reduces
> what's owed. Phase 3 pending. The admin capability slug shipped as `import:create` (single-action
> resource) rather than `import:run`, to fit the existing view/create/edit/delete ACL
> matrix. Recording an `opening` payment to *settle* an imported balance is the one
> deferred piece of the opening-balance flow (the balance imports + shows as owed;
> reducing it is a fast-follow). Migration `0067`.

---

## 1. Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | Patients + procedures + history |
| Who runs it | Owner / super-admin only, behind a new admin ACL capability `import:run` |
| Upload format | CSV **and** Excel (`.xlsx`) |
| Patient number | Fresh `KL-<YYYYMMDD><7-digit>` MRN; the clinic's **old** number kept as a searchable reference |
| Financial history (dues) | **Opening balance per patient** (one figure), not per-visit reconstruction |
| Clinical history | Old notes as **freeform, imported, approved** visit records; **skip** raw past appointment slots |
| Sequencing | **Phased** — Phase 1 first |

### The one principle that drives the design
FlexicaAI's money (sales / shares / receivables) is **derived** from the billing engine
(fee + procedures − discount, via the appointment-completion hook), never stored. So
imported history is **facts-as-given and MUST bypass that derivation** — we never re-run
an imported past visit through our fee model (the old clinic never used it). That is why
dues come in as a flat **opening balance**, not as reconstructed appointment→sale→payment
chains.

---

## 2. Schema changes (migrations)

- `patients.external_ref` text (nullable) — the clinic's **old patient number**. Kept
  distinct from `reference` (which means "how referred"). Add it to patient search so
  front desk can still look a patient up by their old ID. Index (`clinic_id`,`external_ref`).
- `patients.opening_balance` int (default 0) — pre-FlexicaAI dues carried in at import. The
  receivables report + patient statement add the **unsettled** portion to what the patient
  owes; a payment against it is a `patient_payments` row with `appointment_id = NULL` and a
  new `kind = 'opening'` (money in, reduces the opening balance). Outstanding for a patient
  = Σ(appointment outstanding) + opening_balance − Σ(opening payments).
- `patient_payments.kind` gains `'opening'` (settling an opening balance).
- `visits.imported` bool (default false) — marks a note that was imported, not authored in
  FlexicaAI (so it's never confused with an AI-scribe draft). Imported notes are
  `status = 'approved'` with the old text stored as freeform (Phase 2).
- **Import batches (undo):** new table `import_batches` (`id`, `clinic_id`, `entity`,
  `filename`, `row_counts` jsonb, `status` active|undone, `created_by(+name)`, `created_at`)
  + an `import_batch_id` uuid (nullable, no FK) column on `patients` / `procedures` /
  `visits`. "Undo import" = soft-delete every row with that batch id (one action, reuses the
  soft-delete machinery) and roll the clinic's `next_mrn` back if nothing newer was added.

All new columns are additive; core stays specialty-agnostic (patients/procedures/visits are
core tables — no dental coupling).

---

## 3. ACL

Add `import:run` to the admin capability catalog (`core/auth/admin-permissions.ts`). The
owner (NULL permissions) always has it; grant it to specific super-admin team members. Gate
the page and every import server action with `canAdmin(user, "import:run")`. No clinic-side
access at all in v1.

---

## 4. Module + routes

```
core/admin/import/
  parse.ts        # CSV + .xlsx  → normalized string rows (SheetJS xlsx, read-only)
  patients.ts     # zod validate + dry-run + commit (MRN alloc, dedup, batch tag)
  procedures.ts   # zod validate + dry-run + commit
  balances.ts     # opening-balance apply (Phase 1)
  visits.ts       # freeform clinical-note import (Phase 2)
  batches.ts      # record + undo an import batch
app/admin/clinics/[id]/import/   # page + actions, gated by import:run
```

- **Excel:** add `xlsx` (SheetJS), pinned/current, used only server-side to turn a sheet
  into rows. After parsing, CSV and Excel run the **identical** validation path.
- **Templates:** a downloadable CSV template per entity with the exact expected columns
  (removes the column-mapping guesswork).

---

## 5. Flow (every entity)

1. Pick entity (Patients / Procedures / Clinical notes) → **download template**.
2. **Upload** CSV or `.xlsx`.
3. **Dry-run preview** — server validates every row and returns counts + the offending rows:
   **ready / warnings / duplicates / errors**. Nothing is written yet.
4. **Column mapping** — the preview also returns the auto-detected column mapping and the
   file's headers; a panel lets the user correct any wrong match (target field → their
   column) and **re-check**. So a clinic's sheet never has to match our exact headers.
   Fields + aliases live in `core/admin/import/fields.ts` (`resolveMapping`/`applyMapping`).
5. **Confirm** → one transaction, tagged with a new `import_batch_id`.
6. **Summary** — "312 imported, 4 skipped (duplicate phone), 2 flagged (bad phone)" + an
   **Undo import** button.

Re-running the same file is idempotent (dedup catches it). Undo is one click.

---

## 6. Validation & rules

**Patients**
- `full_name` required.
- `phone` normalized to E.164 (`+92…`/`+971…`); invalid → **warning**, still imported (phone
  is nullable, but it's the WhatsApp key so we flag bad ones).
- Age **or** DOB accepted; stored as DOB. A "registered on" column, if present, sets
  `created_at` so the **MRN's date segment reflects the real first visit**, not the import day.
- `gender`, `address` optional. `data_consent` defaults **false** (importing doesn't imply
  consent — §10 compliance); clinic sets it later.
- `external_ref` ← old patient number. `opening_balance` ← dues (int PKR, ≥ 0).
- **Dedup by (`clinic_id`, `phone`)** — skip existing by default (option: update).
- **MRN:** batch **locks the clinic row**, assigns sequential `mrn`, advances `next_mrn`
  past the batch (same rule as `createPatient`, batched).

**Procedures**
- `name` required, `price` int ≥ 0, `module` tag, `is_active` default true. Dedup by name.

**Opening balances** (can be a column on the patient sheet or its own sheet keyed by
external_ref/phone) — sets `patients.opening_balance`.

---

## 7. Phasing

- **Phase 1 (makes a clinic fully usable):** Patients (MRN + external_ref + phone-normalize
  + dedup) · Procedures · Opening balances. Template + CSV/Excel upload + dry-run + undo.
- **Phase 2:** Clinical-notes history — freeform imported/approved visit records, with
  doctor-name → staff mapping (staff created first). Skip raw appointment slots.
- **Phase 3:** Anything a specific clinic genuinely needs beyond the above.

---

## 8. Open risks / notes

- **Doctor mapping (Phase 2):** imported notes reference old doctors; create staff first,
  then map names → users; unmapped → no doctor (name kept in the note).
- **Opening-balance settlement** touches the receivables/statement core — small, contained
  addition, but must reconcile with the existing derived outstanding.
- **`xlsx` dependency** — pin a current version; parse read-only; never trust the sheet
  (validate every cell through zod like CSV).
- Timezone: `created_at`/dates use the server-local convention already documented for the app.
