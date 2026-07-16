# Discount bearing & doctor–clinic settlement — plan

> **Status: PLAN (awaiting approval). No code until this is approved.**
> Builds on `docs/doctor-shares-plan.md`. Owner-approved policy captured 2026-07-17.

## 1. The policy (approved)

When a discount is given, **whoever bears it absorbs it in full; the other party keeps
its normal earned share. No spillover onto the party that didn't authorise it.** A
bearer's balance may go **negative** (a doctor can *owe* the clinic; the clinic's cut on
a visit can be negative).

Worked baseline — procedure **Rs 2000**, doctor share **10%** (doctor gross `D0 = 200`,
clinic gross `C0 = 1800`):

| Scenario | Doctor ends | Clinic ends | Protected |
|---|---|---|---|
| Doctor grants 2000 (doctor-borne) | **−1800** (owes clinic) | **1800** | Clinic |
| Clinic grants 2000 (clinic-borne) | **200** (paid normally) | **−200** (pays doctor from pocket) | Doctor |
| Split — doctor bears portion `r` of K | `D0 − r·K` | `C0 − (1−r)·K` | neither |

Both waive directions are allowed (see §6): a doctor may waive **his own** share to
relieve the clinic; the clinic may waive a doctor's **deficit** to relieve the doctor.

## 2. Approved decisions

1. **Scope** — only the **appointment-level** discount carries bearing; per-line
   procedure reductions (if any) are plain, no bearing.
2. **Recognition** — bearing is **accrual**, snapshotted **at completion**, in its own
   settlement ledger, **separate** from collected-basis earnings.
3. **History** — **forward-only.** Past completed visits keep their current numbers; the
   new rule applies to visits completed on/after ship.
4. **Multi-doctor visit** — a doctor-borne discount is split across the visit's earners
   **proportional to each one's gross share** (consultation doctor + each procedure's
   performing doctor).
5. **Consent** — a doctor-borne discount set by someone **other than that doctor**
   requires the doctor's approval **only when that doctor's `discount_needs_approval`
   switch is on** (reuse the existing per-doctor setting; not automatic). A doctor
   discounting **their own** visit needs no one.
6. **Approval scope** — only the **bearing** party signs off (doctor for doctor-borne,
   clinic for clinic-borne, **both** for split), each gated by its existing
   needs-approval switch.
7. **Amount split** — stored as a **fixed amount**, shown as its equivalent %; if the
   discount later changes, **flag for re-entry** (never silently scale).
8. **Negative balances** — allowed. A doctor deficit **auto-nets against future
   earnings**; the clinic can also record a **doctor→clinic repayment** or **waive** it.
9. **Waives** — **per earning line**, **bidirectional**, **reversible**, audit-logged,
   permission-gated. A clinic-side waive is a **clinic cost** (hits P&L).
   **Independent of the approval workflow:** a waive is a voluntary relief action by
   the doctor (his own share) or a `share_waive` holder / clinic admin (a doctor's
   deficit), available whether or not the discount ever needed approval. It operates on
   the **effective** bearing only — nothing to waive while a discount is still
   pending/rejected; once it's applied and the visit completes, either party may waive.
10. **Doctor leaves owing** — the debt is carried as a **receivable on that doctor**
    until settled or explicitly **written off**.

## 3. Money model (⚠ VALIDATE the partial-payment rows before build)

Two **independent** ledgers so the discount accrual never fights the collected-basis:

- **Earnings — existing `sale_shares` (collected-basis, ≥ 0).** Splits money the patient
  **actually paid** by each party's **gross share %** (change: split by gross %, not by
  the post-discount net — the discount is handled entirely by the settlement ledger, so
  it isn't double-counted here).
- **Discount settlement — NEW `discount_settlements` (accrual, may be ±).** At
  completion, the bearing party's position is reduced by their portion of the effective
  (approved) discount `K`; the protected party is untouched. Recognised on `K` at
  completion, **not** scaled by collection.

Each party's **balance** = Σ earnings (collected) + Σ settlement (accrual) + Σ waives −
Σ payouts + Σ repayments. May be negative ⇒ the doctor owes.

**Settlement formula (fixed at completion — resolved, option a).** With gross `G`, net
`N = G − K`, each party's gross share `S(party)` (clinic `C0`, doctor `D0_i`):

```
settlement(party) = target(party) − N × S(party) / G
```
`target` = the make-whole position for the borne-by:
- doctor-borne → `target(clinic) = C0`, `target(doctor_i) = D0_i − (doctor_i's share of K)`
- clinic-borne → `target(doctor_i) = D0_i`, `target(clinic) = C0 − K`
- split (doctor bears `r·K`) → doctors share `r·K` (∝ gross), clinic bears `(1−r)·K`

The settlement is a **snapshot at completion**, computed on `N` + gross shares only — it
**does not** move when the patient pays. **Earnings** (`sale_shares`) float with actual
collection, so uncollected amounts defer naturally and the totals **converge to
make-whole** as the patient pays down. The patient's unpaid balance stays a **separate
receivable** — it never distorts the settlement.

**Worked examples** — `G=2000, D0=200, C0=1800`:

| Case | K | Paid P | doctorEarn (P·D0/G) | clinicEarn (P·C0/G) | settlement (dr / clinic) | **doctor total** | **clinic total** |
|---|---|---|---|---|---|---|---|
| Doctor-borne, 100% | 2000 | 0 | 0 | 0 | −1800 / +1800 | **−1800** | **1800** |
| Clinic-borne, 100% | 2000 | 0 | 0 | 0 | +200 / −200 | **200** | **−200** |
| Doctor-borne, K=500, net paid | 500 | 1500 | 150 | 1350 | −450 / +450 | **−300** | **1800** |
| Clinic-borne, K=500, net paid | 500 | 1500 | 150 | 1350 | +50 / −50 | **200** | **1300** |
| Doctor-borne, K=500, part-paid | 500 | 1000 | 100 | 900 | −450 / +450 | **−350** | **1350** |

Row 5 shows convergence: settlement is unchanged (−450/+450); as the remaining 500 is
collected, earnings rise (+50 dr / +450 clinic) → doctor **−300**, clinic **1800**.

## 4. Schema / migration (additive)

- **`discount_settlements`** — one snapshot row per party per completed visit:
  `clinic_id, appointment_id, party ('clinic'|'doctor'), doctor_id (null for clinic),
  doctor_name snapshot, gross_share, discount_borne (±), occurred_at (= scheduled_at),
  created_at`. Rewritten on the completion hook / edit / approval, like `sale_shares`.
  Soft-delete not needed (snapshot; voided by re-write).
- **`doctor_settlement_actions`** — waives, repayments, write-offs:
  `clinic_id, doctor_id, appointment_id (nullable), line_ref (nullable — procedure/
  consultation), kind ('doctor_waive'|'clinic_waive'|'repayment'|'write_off'|'reversal'),
  amount, reverses_id (nullable), note, created_by(+name), created_at`.
- **Appointments** — `discount_split_type ('percent'|'amount')` + `discount_split_value`
  (the doctor's portion for borne='split'), and a `discount_split_stale` flag set when
  the discount changes after a fixed-amount split was entered (decision #7).
- No change to `sale_shares` columns; its **computation** changes (gross-% basis).
- One new permission: **`share_waive`** (clinic-side waive / repayment / write-off).
  A doctor waiving his own share is allowed by his own identity.

## 5. Core computation

- New pure module `core/appointments/discount-bearing.ts`:
  `computeBearing(context, borneBy, split) → { clinic: number, doctorById: Record<…> }`
  (signed; no spill; multi-doctor proportional per #4). Reuses
  `getAppointmentShareContext`.
- `core/appointments/shares.ts#computeShare` — the **collected split** switches to gross
  proportions (drop the borne-by discount attribution here; it moves to bearing).
- `core/sales/share-ledger.ts` — on the completion hook, also (re)write
  `discount_settlements`; void on un-complete / soft-delete; re-write on edit/approval.
- Balances (`core/sales/payouts.ts`) — fold settlements + settlement-actions into
  Earned/Paid/Outstanding; allow **negative outstanding** (doctor owes). `recordPayout`
  guard relaxed; add `recordRepayment` (doctor→clinic) and `writeOff`.

## 6. Waives & settlement UX

- **Doctor waives own share** — from the appointment detail (his line) and/or his
  earnings view; per line; reversible.
- **Clinic waives doctor deficit / records repayment / write-off** — from `/clinic/shares`
  (scoped to a doctor), `share_waive` permission; reversible; audit-logged.
- Clinic waive → recorded as a **clinic cost** so it shows in **P&L**.

## 7. Reporting

- **Discounts report** — show the **final** clinic/doctor bear amounts (after waives),
  borne-by, split % (from fixed amount), approver (existing), and any waive with who/when.
- **Doctor statement / `/clinic/shares`** — separate lines: **Earned** (collected),
  **Discount borne** (±), **Waives**, **Repayments**, **Outstanding** (may be negative =
  owes). Doctor sees their own.
- **P&L** — clinic-borne discounts + clinic waives = clinic cost; ensure no double-count
  with the gross-% earnings change.
- **Owner view** — total doctor deficits (who owes the clinic).

## 8. Approval alignment

- Regenerate approvals with the **bearing** parties only (doctor-borne → doctor;
  clinic-borne → clinic; split → both), each gated by its `discount_needs_approval`
  switch (decisions #5, #6). Settlement rows are written only for the **effective**
  (approved) discount, exactly like the current `discount_status` gating.

## 9. Phasing

1. Schema + migration + the **`share_waive` ACL slug** + `computeBearing` (pure) +
   unit tests (the §3 table). *(Permission added now as the foundation; its actions
   are enforced in Phase 4.)*
2. **`discount_settlements` written on the completion/edit/approval hooks as a SHADOW
   ledger** — populated + DB-verified (matches `computeBearing`, zero-sum), but nothing
   reads it yet, so **zero behaviour change**. *(The `sale_shares` gross-% switch is
   deferred to the reader cutover so numbers never go transiently wrong — see below.)*
3. **Reader cutover (atomic):** `sale_shares` → gross-% basis **and** balances/shares
   report/P&L/dashboard-KPI fold in the settlements, together; `getDoctorBalances`
   gains a signed `borne` and allows **negative** outstanding (a doctor may owe).
4. Settlement ACTIONS: waives (both directions, enforcing `share_waive`) +
   `recordRepayment` (doctor→clinic) + `writeOff` + reversal, folded into the balance.
5. Reports/statement/P&L wiring + discounts-report final split & waive display.
6. Consent/approval regeneration for bearing parties.

Each phase: DB-tested, `tsc` clean, `e2e` green — same bar as the rest of the app.
