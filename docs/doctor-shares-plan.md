# Doctor–Clinic Revenue Share + Discount Approval

> Status: **v1 COMPLETE** ✅ — all six phases shipped: 1 (schema + `computeShare`),
> 2 (config UI), 3 (discount borne-by + approval), 4 (`sale_shares` ledger),
> 5 (`/clinic/shares` report), 6 (payouts). v1 scope = gap points 1–6.
> Not in v1 (unchanged): tax, material/lab cost, future-dated rates, manual per-visit
> override, refunds.
> Not in v1: tax, material/lab cost, future-dated rates, manual per-visit override,
> refunds (need the payments layer).

## 1. What it does
Every **completed** visit's revenue is split between the **clinic** and the
**doctors** who earned it, using each doctor's configured shares. Discounts are
attributed to whoever bears them; when the bearer requires it, a discount needs
**approval** before it applies. Clinic and each doctor get a **share earnings
report**, and the clinic can record **payouts** to settle what's owed.

## 2. Doctor configuration (clinic admin, on the staff page)
Per doctor, a **Revenue share** section:
- **Consultation share %** — cut of the consultation fee.
- **Default procedure share %** — fallback for any procedure.
- **Per-procedure rates** — `procedure → %` overrides (Cleaning 10 · Root canal 30 ·
  Scaling **0**). Missing row → default; a stored `0` → explicit 0% (distinct from
  unset).
- **"My discounts need approval"** switch — editable **both** by the clinic admin
  here **and** by the doctor on their own account settings (choice B).

## 3. Multiple doctors per visit
- The **consulting doctor** (`appointments.doctor_id`) earns the **consultation** share.
- Each **procedure line** carries a **performing doctor**
  (`appointment_procedures.doctor_id`, defaults to the consulting doctor) who earns
  **that line's** share at **their own** rate for that procedure.

## 4. The split math — `computeShare` (pure)
On **gross** (pre-discount) amounts:
```
doctor gross = consult% × consultation (consulting dr)
             + Σ ( lineRate% × unit×qty )  (each dr on their lines)
clinic gross = grossTotal − Σ doctor gross
```
Then the **total discount** (line + appointment) is attributed by **borne-by**, with
**spill/clamp** so no share goes negative and `Σ doctor + clinic = net` exactly;
rounding remainder → clinic. A line with no `procedure_id` (deleted procedure) uses
the **default** rate. Returns **{ doctorId → share, clinic }**.

### Worked example (two doctors)
Dr A: consult 60%, default proc 30%, {Cleaning 10, Root canal 30}. Dr B: Root canal 30%.
Visit: consultation 1,000 (A) · Cleaning 2,000 (A) · Root canal 8,000 (B).
```
A = 1,000×60% + 2,000×10%      = 800
B = 8,000×30%                  = 2,400
gross total = 11,000 → clinic  = 7,800
Discount 1,400 (net 9,600):
  borne Clinic → A 800, B 2,400, clinic 6,400
  borne Doctor → A/B reduced proportionally (A 800−… , B 2,400−…), clinic 7,800
  borne Split  → all three reduced proportionally
```

## 5. Discounts — borne-by
`appointments.discount_borne_by` = **Clinic** (default) · **Doctor** · **Split**.
- Clinic → clinic absorbs; doctors keep full share.
- Doctor → the doctor(s) absorb (proportionally if several).
- Split → proportional across everyone.

## 6. Discount approval workflow
Two switches decide if a discount needs approval **before it applies**:
- `clinics.discount_needs_approval` (clinic admin) → **clinic-borne** discounts.
- `users.discount_needs_approval` (per doctor) → **doctor-borne** discounts.

**Required approvers** = parties whose share is reduced **and** who require approval:

| Borne by | Approvers |
|---|---|
| Clinic | clinic (if clinic requires) |
| Doctor | each affected doctor (each if they require) |
| Split | clinic + each affected doctor (per their switch) — the union |

- **Pending until all approve** → while pending the bill/sale/shares use
  **discount = 0**. On full approval it applies (a completed visit's sale re-snapshots).
- **Rejected** by any required approver → discount set to **0** (staff can re-submit).
- **Completion is non-blocking** (record at full price, update if approved later).
- **Approver identity:** clinic approver = a grantable **`discount_approval`**
  permission (clinic_admin by default); doctor approver = the affected doctor.
- **Queue:** a "Discount approvals" list — a doctor sees requests off *their* share;
  a clinic approver sees clinic-borne ones. Approve/reject + note. Appointment shows a
  **Pending / Approved / Rejected** badge.

## 7. The ledger (per-doctor)
New **`sale_shares`** table snapshots the split at completion:
`(clinic_id, appointment_id, doctor_id, doctor_name, share_amount, occurred_at,
payout_id)`. Clinic share = net − Σ doctor shares. Amounts (and the rates used) are
snapshots, so later rate edits never rewrite history.

## 8. Reports & payouts
- **`/clinic/shares`** report (reuses the Sales report engine): per-doctor **earned**
  shares + the **clinic** total over a period + trend chart; filter by period/doctor.
  Gated by a new **`shares`** permission; a **doctor sees only their own**.
- **Payouts:** a **`doctor_payouts`** record settles a doctor's accrued shares for a
  period — batches the unpaid `sale_shares` in range, stamps their `payout_id`; the
  report shows **Earned / Paid / Outstanding**.

## 9. Schema (new)
- `users`: `consultation_share_pct`, `procedure_share_pct`, `discount_needs_approval`.
- `clinics`: `discount_needs_approval`.
- `appointments`: `discount_borne_by`.
- `appointment_procedures`: `doctor_id`.
- New tables: `doctor_procedure_shares`, `appointment_discount_approvals`,
  `sale_shares`, `doctor_payouts`.
- New permissions: `shares` (view; doctor self-view), `discount_approval` (approve).

## 10. Build phases
1. **Schema + `computeShare`** (per-doctor map; fallback, spill/clamp, rate-0) + tests. ✅
2. **Config UI** — doctor Revenue-share section (shares + rates + approval switch) on
   the staff page **and** the doctor's account switch; **per-line performing-doctor**
   picker on the appointment form. ✅ Rates read via
   `core/appointments/share-config.ts` (`getDoctorShareRates` /
   `getDoctorShareRatesMany` for the split; `replaceDoctorProcedureShares` to save).
   The clinic-level approval switch + borne-by selector land in Phase 3.
3. **Discount borne-by + approval module** — settings, approval queue,
   pending-blocks-discount, badges. ✅ `appointments.discount_status` +
   `appointment_discount_approvals` table + `discount_approval` permission;
   `core/appointments/share-context.ts` (assembles the split input) and
   `approvals.ts` (`syncDiscountApprovals` on create/edit, `decideDiscountApproval`);
   pure `fee.ts#effectiveDiscountValue` gates the bill/sale/quote everywhere; a
   borne-by selector on the appointment form, the clinic switch + queue at
   `/clinic/approvals`, and Pending/Approved/Rejected badges. **Default (borne =
   clinic, all switches off) → status 'none' → the discount applies exactly as
   before**, so the workflow is inert until a party opts in.
4. **`sale_shares` ledger** — snapshot on completion; re-snapshot on edit; void on
   un-complete. ✅ `sale_shares` table (per-DOCTOR rows; clinic cut derived);
   `core/sales/share-ledger.ts` folded INTO `recordSaleForAppointment` /
   `voidSaleForAppointment` / `backfillClinicSales`, so every existing sales hook
   (completion, edit-if-completed, approval decision, trash void/restore) keeps the
   share ledger in lockstep, on the approval-gated net. Inert when no doctor has a
   share %. Verified against the DB (multi-doctor split, all borne-by modes, pending
   gating, void).
5. **`/clinic/shares` report** + `shares` permission (doctor self-view). ✅
   `core/sales/share-report.ts` (reuses the Sales report's range/bucket helpers):
   per-doctor earned + the clinic's derived cut (net − Σ shares) + a
   share-over-time chart, filter by period/doctor. A doctor holds `shares:view` by
   default but is self-scoped (own earnings only, no clinic totals); a clinic admin /
   granted manager sees everyone. Reuses `SalesChart` / `SalesFilters`. Not
   feature-gated. Verified against the DB (full + scoped).
6. **Payouts** — record/settle, Earned/Paid/Outstanding. ✅ `doctor_payouts` table +
   `sale_shares.payout_id` FK (set null on delete). `core/sales/payouts.ts`:
   `recordPayout` (batches a doctor's unpaid shares in range → stamps them + writes
   the settlement, atomic), `voidPayout` (reverses — un-stamps via FK), `listPayouts`.
   The report gained Paid/Outstanding (from `payout_id` null-ness in range); a
   clinic admin records a payout from `/clinic/shares` when scoped to a doctor, and
   sees payout history with a Reverse control. Verified against the DB (record →
   paid/outstanding → double-guard → void → reversal).

## 11. Phase 7 — partial payments + running balance + statement (post-v1)

**Why:** v1 payouts settled *whole visits in a date range* (amount computed from the
batched shares). Real clinics pay **arbitrary amounts on account** ("earned 10,000,
paid 5,000, 5,000 left"). Phase 7 switches to an **amount-based lifetime running
balance**: pay any amount, partial allowed, balance reduces.

**Model change (amount-based, not per-share stamping):**
- `Earned` = Σ `sale_shares.share_amount` (all completed, ALL TIME).
- `Paid` = Σ `doctor_payouts.amount` (ALL TIME).
- `Outstanding` = Earned − Paid. Balances are lifetime, not period-scoped.
- `sale_shares.payout_id` is **dropped** (superseded — no per-visit paid flag).
- `recordPayout(doctorId, amount, method, reference, note)` takes an ARBITRARY amount
  (validated `0 < amount ≤ outstanding`); no share stamping. `voidPayout` just
  deletes the row → the balance rises again.
- `doctor_payouts` gains `method` (cash/bank/…) + `reference`.

**UI (`/clinic/shares`):**
- A **Balance** section (all-time, unaffected by the period filter): Earned / Paid /
  Outstanding cards; per-doctor table with those three columns.
- The **period filter** now scopes only the earnings-over-time chart + "earned this
  period" (analysis), not the balance.
- **Record payment** (clinic admin, scoped to a doctor): an amount input (default =
  outstanding, max = outstanding) + method + reference + note.
- Payment history shows method/reference; Reverse stays.
- A **printable statement** (`/clinic/shares/statement?doctorId=…`): the doctor's
  earning visits + payments + running balance, print-to-PDF friendly.

**Sub-phases:** 7a schema + amount-based `payouts.ts`/balances + report split (DB
tested); 7b UI (balance section, amount-input payment form, history); 7c printable
statement.

**Status: DONE ✅** (migration 0038). `sale_shares.payout_id` dropped;
`doctor_payouts` gained `method`/`reference` and now holds arbitrary-amount payments.
`core/sales/payouts.ts` rewritten: `getDoctorBalances`/`getDoctorBalance` (lifetime
Earned/Paid/Outstanding), `recordPayout(amount, method, reference, note)` (partial;
validated `0 < amount ≤ outstanding`), `voidPayout`, `listPayouts`. `share-report.ts`
now only does period earnings/chart (+ `listDoctorEarnings` for the statement).
`/clinic/shares`: lifetime balance cards, a per-doctor balances table (drill-in
links), an amount-input payment form (method/reference/note), payment history with
method + Reverse, and a **printable statement** at `/clinic/shares/statement`.
Verified against the DB (12/12): partial pay → outstanding drops, overpay blocked,
full settle, void restores balance, clinic-wide list.

## 12. One-doctor-per-appointment simplification (post-Phase 7)

At the owner's direction, the recommended workflow is **one doctor per appointment**
(e.g. a consultation with Dr A and a procedure with Dr B are two appointments —
the second a procedure-only visit via the "Charge consultation" toggle). This makes
discounts unambiguous. The appointment form was simplified accordingly:
- The **per-line performing-doctor** picker is removed — every procedure line's
  performing doctor is the **appointment's** doctor, set server-side
  (`actions.ts#withApptDoctor`).
- The **per-procedure discount field is removed** — there is now ONE discount, the
  appointment-level one. (The `appointment_procedures.discount_*` columns + the
  per-line fee math remain for legacy rows and stay 0 for new ones.)
- **"Discount borne by" keeps Clinic / Doctor / Split** — a discount can still be
  split between the doctor and the clinic.
The core (`shares.ts` / `share-context.ts`) is unchanged (still supports per-line
doctors + split). Verified end-to-end against the DB (4/4): the procedure inherits
the appointment's doctor, and Dr Bilal's example (2000 consult @15% + 4000 extraction
@15%) resolves to 900 (no discount) / 900 (clinic-borne) / 300 (doctor-borne).
