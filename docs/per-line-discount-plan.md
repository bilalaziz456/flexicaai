# Per-line discounts, each with its own "Borne by" — plan

> **Status: PLAN — APPROVED 2026-11-06** (§2 and §10 decided by the owner). Build in
> the phases of §11.
> Owner's decisions taken 2026-11-06 (§2, §10). Builds on `docs/discount-bearing-plan.md`
> and `docs/doctor-shares-plan.md`, and **supersedes discount-bearing decision 1**
> ("only the appointment-level discount carries bearing; per-line reductions are
> plain"). Building it needs an ADR in `.claude/architecture.md`.

## 1. The problem

A visit has ONE "Borne by" (clinic / doctor / split) for its whole discount. When the
doctor side bears it, the discount is spread over **every doctor on the visit** in
proportion to their share (`computeBearing` → `allocate(doctorBorne, doctorIds,
doctorGross)`), whichever line was discounted.

| Line | Price | Doctor | Share | Doctor's gross share |
|---|---|---|---|---|
| Consultation | 1,000 | Dr A | 50% | 500 |
| Scaling | 4,000 | Dr A | 40% | 1,600 |
| Root canal | 10,000 | Dr B | 50% | 5,000 |

Dr B gives **Rs 2,000 off the root canal**, borne by the doctor. Today Dr A (2,100 of
the 7,100 doctor gross) bears **Rs 592** and Dr B **Rs 1,408**. Dr A pays for a
discount they did not give. With one doctor per visit the rule is right; with two it is
not, and two-doctor visits (consultant + specialist) are routine.

## 2. Decisions (owner, 2026-11-06)

| # | Question | Decision |
|---|---|---|
| 1 | The overall (whole-visit) discount | **Kept**, with its own Borne by (exactly as today) |
| 2 | The consultation fee | **A line**: its own discount and Borne by (clinic / consulting doctor / split) |
| 3 | Services & other charges | Discount always borne by the **clinic**; no Borne by shown |
| 4 | Approval | Follows the existing switches: a bearer is asked only if its *discount needs approval* switch is on, and only about what IT bears |
| 5 | Treatment plans | Each booked item carries its plan discount **on its own line**, with the plan's Discount by; no approval while unchanged (as today) |
| 6 | Past visits | **Untouched.** The new rule applies to visits saved from now on, and to an old visit only when its discounts are edited |
| 7 | Clinic offer | **Borne by set on the offer** in the price list, once, and snapshotted onto the line; never asks approval |

## 3. The model: a visit's discount is a list of PIECES

Each piece is `{ amount, borneBy, split, doctor }`, where `doctor` is **whose** share a
doctor-borne piece comes from:

| Piece | Amount | Borne by | `doctor` |
|---|---|---|---|
| Clinic offer on a line | the offer | the offer's own (§5) | the line's performing doctor |
| Patient discount on a line | typed at the desk | chosen per line | the line's performing doctor |
| Consultation discount | typed at the desk | chosen | the consulting doctor |
| Overall discount | as today | as today | **none** → spread over all the visit's doctors by gross share (today's rule) |
| Any discount on a service line | — | always clinic | — |

`computeBearing` takes the list instead of one `{discount, borneBy, split}`. Per piece,
`discountBorneSplit` (unchanged) gives the doctor side's part; a piece with a `doctor`
charges that part to that doctor alone, a piece without one is allocated across the
doctors as today. Clinic parts sum. Everything else — make-whole targets, zero-sum
settlements, negative balances, waives — is unchanged.

**An old visit is one piece with no `doctor`**, which is today's calculation exactly.
That is how decision 6 holds by construction rather than by care, and the test in §9
asserts it.

### Worked example (new rule)

Same visit. Discounts: root canal **2,000 borne by Dr B**; consultation **200 borne by
the clinic**; overall **300, split 50% doctor**. Gross 15,000 → net **12,500**.

| Piece | Clinic bears | Dr A bears | Dr B bears |
|---|---|---|---|
| Root canal 2,000 (Dr B) | 0 | 0 | 2,000 |
| Consultation 200 (clinic) | 200 | 0 | 0 |
| Overall 300, 50% doctor | 150 | 44 | 106 |
| **Total** | **350** | **44** | **2,106** |

Make-whole: clinic 7,900 − 350 = **7,550** · Dr A 2,100 − 44 = **2,056** · Dr B
5,000 − 2,106 = **2,894** · Σ = **12,500** = net. Dr A carries only their slice of the
overall discount, which the visit as a whole was given.

## 4. The bill (what the patient pays) — order of deduction

Per line: **price × qty → clinic offer → patient line discount** = line net.
Consultation: **fee → consultation discount**. Subtotal = Σ. **Overall discount** on the
subtotal = total. Each step clamps at 0, as today. Percentages are of what is left at
that step (a 10% line discount after a 10% offer = 19% off, not 20%), the same
layering the treatment-plan bill already uses (`core/patients/plan-bill.ts`).

The invoice prints each line's total discount; **who bears it is never printed** (same
rule as plan estimates, owner's call 2026-10-21).

`fee.ts#computeBill` stays the single formula. Its SQL mirror (`appointmentNetSql`) gets
the new terms and `scripts/test-bill-parity.ts` the new columns (ADR-015/021: money in
SQL runs in `numeric`).

## 5. Clinic offers

The offer form on **Procedures** gains **Borne by**. (A Service's offer has none: the
clinic bears it, decision 3.) A line snapshots it with the offer amount, so changing an
offer never re-shares a booked visit.

**Default: "In proportion"** (decided, §10 a) — a fourth option meaning *today's rule*: the
doctor's share is worked out on the price after the offer, so each side gives up its %
(owner's call 2026-10-11, `share-context.ts`). Every EXISTING offer keeps that, so no
visit's shares change until the clinic chooses otherwise; new offers default to it too.
Clinic / doctor / split offers are pieces like any other: the doctor's share is
computed on the **full** price and the offer is borne as chosen.

## 6. Approval

Today: one decision per visit — required approvers are the bearers whose switch is on;
until all have approved, the WHOLE patient discount counts as 0.

New: approver rows are still per visit, one per required party, but **each piece waits
only for its own bearer(s)**:

- A line borne by Dr B → Dr B is asked, if Dr B's switch is on. Dr A is not asked.
- Clinic-borne → the clinic, if its switch is on. Split → both sides, each if on.
- The overall discount → as today.
- Clinic offers and unchanged plan discounts → never asked.

A piece whose bearer has not approved (or rejected) counts as 0; the others apply. So
Dr B sitting on a request no longer holds up a discount the clinic gave. The visit's
`discount_status` stays as the summary (pending while anyone is pending). Decided
(§10 b) over today's all-or-nothing.

## 7. Treatment plans

`plan-bill.ts` already gives each item its `planDiscount` (own + its share of the plan's
overall discount). Booking items onto a visit puts each item's `planDiscount` **on that
item's line** as its patient discount, borne by the plan's Discount by — so "doctor"
now means *that item's* doctor. `appointments.discount_from_plan` becomes per line
(`appointment_procedures.discount_from_plan`); a line still carrying its plan discount
unchanged needs no approval, as today.

## 8. Changes

**Schema (additive, one migration):**

- `appointment_procedures`: `patient_discount_type/value`, `discount_borne_by`,
  `discount_split_type/value`, `discount_from_plan`; offer snapshot `offer_borne_by`
  (+ split). The existing `discount_type/value` stay the clinic offer.
- `appointments`: `consultation_discount_type/value`, `consultation_borne_by` (+ split);
  `bearing_version int default 1` — set to 2 when a visit's discounts are saved under
  the new rule. Version 1 is read exactly as today (§3).
- `procedures`: `offer_borne_by` (+ split), default "in proportion".
- `discount_bearers` vocabulary: add `proportional` (offers only).

**Core:** `fee.ts` (bill), `share-context.ts` (pieces, share base per offer bearer),
`discount-bearing.ts` (pieces), `settlement-ledger.ts`, `approvals.ts` (per-piece
gating), `procedure-offer.ts`, plan booking, `discounts-report.ts` (a row per piece:
which line, which doctor, who bore it), `bill` SQL + parity test.

**Screens:** booking form and invoice editor — each line gets *Discount [Rs | %]* and
*Borne by [Clinic | Dr X | Split]*, the consultation row the same, the overall section
unchanged; service lines show the discount only. Procedures price list — Borne by on
the offer. Approvals inbox — each request names the line it is for. Discounts report —
per piece.

Not changed: what the patient pays for any existing visit, the invoice layout, payments,
receivables, the sales ledger amounts.

## 9. Tests

- **Old visits identical:** for every completed visit in the database, version-1
  settlement rows and share rows before == after (like `test-dashboard-trends.ts`).
- Pure: bearing pieces (the §3 example, Σ = net, single-doctor visit equals today,
  service lines always clinic), bill order, percent-after-offer.
- Parity: SQL bill == TS bill with the new columns (randomised).
- Approvals: a pending Dr B gates only Dr B's pieces.
- Plan booking: each item's line carries its `planDiscount` with the plan's bearer.

## 10. Confirmed (owner, 2026-11-06)

a. **Offers default to "In proportion"** (today's rule) — existing and new — so nothing
   moves until a clinic picks Clinic / Doctor / Split on an offer.
b. **Approval per piece** (§6): a bearer who has not approved holds up only what it
   bears; the visit's other discounts apply now.
c. **The overall discount, doctor-borne,** is shared between the visit's doctors in
   proportion to what each earns on it, as today (not the consulting doctor alone, not
   equally).

## 11. Phasing (each phase ships on its own)

1. **Core, pure:** bearing pieces + bill order + tests. No behaviour change yet
   (everything is still version 1). — **DONE 2026-11-06:** `fee.ts` (patient line
   discount after the offer; consultation discount), `discount-bearing.ts`
   (`computeBearingPieces`, `buildDiscountPieces`), `scripts/test-discount-pieces.ts`
   (12 checks; old bill and old bearing reproduced exactly over 8,000 random visits).
2. **Schema + data paths:** migration, reads/writes, `bearing_version`, settlement and
   share writers; old-visit identity test against the real database. — **DONE
   2026-11-06:** migrations `0138` (columns, `proportional` bearer, CHECKs) and `0139`
   (`patient_discount_held`, `consultation_discount_held` — the per-piece approval gate
   of §6 stored where the discount is, so the SQL bill can apply it row by row). The
   bill (TS and SQL) reads every new column; `share-context.ts` builds pieces for a
   version-2 visit and `settlement-ledger.ts` bears them with `computeBearingPieces`;
   `saveAppointmentProcedures` writes the line's patient discount and snapshots the
   offer's bearer (`applyClinicOffers`, kept on edit). Invoice prints the consultation
   discount. Tests: `test-bill-parity.ts` (new columns, held and not),
   `test-old-visits-unchanged.ts` (822/822 visits identical). Nothing sets version 2
   yet — no screen writes these columns until phase 3.
   **Carried to later phases:** the held flags are written by approvals (phase 4), and
   `share-context#patientDiscount` still measures the overall discount only; the
   treatment-plan booking insert still uses defaults (phase 5).
3. **Booking form & invoice editor:** per-line discount + Borne by; consultation row.
   — **DONE 2026-11-06:** `line-discount.tsx` (`LineDiscountEditor`: "+ Discount", Rs/%,
   and Clinic / Doctor / Split on a procedure or the consultation; services and other
   charges take the clinic's), used under every line of `new-appointment-form.tsx`, which
   both the booking page and the invoice editor render (`form-initial.ts` seeds an
   edit). The overall field is now "Discount on the whole visit". Every new visit is
   saved as version 2; an edit moves a visit to 2 only when its discounts change.
4. **Approvals per piece** and the inbox wording. — **DONE 2026-11-06:**
   `syncDiscountApprovals` asks the parties bearing any discount (rows stay one per
   party per visit); `applyApprovalGates` releases each discount when ITS bearers have
   approved and writes the held flags. The Approvals inbox lists each discount with
   what the reader bears ("Crown: Rs 3,000 off (you bear Rs 3,000)").
5. **Offers' Borne by** in the price list; **plan carry** per line. — **DONE
   2026-11-06:** the Procedures offer dialog has Borne by (In proportion / Clinic /
   Doctor / Split), shown on the row's offer line; Services keep the clinic's.
   `scheduleItemsOnAppointment` puts each item's plan discount on its own line with the
   plan's bearer and `discount_from_plan`; the whole-visit discount is no longer filled
   from the plan, and the form's plan-terms check is gone.
6. **Reports** (Discounts per piece, settlements) + ADR + `.claude/database.md`. —
   **DONE 2026-11-06:** the Discounts report (page, CSV, Overview card) has one row per
   discount with a "For" column and its own status; totals add each kind in SQL. The
   revenue-shares report needed nothing: it reads `discount_settlements`, which the
   ledger writes per piece since phase 2. ADR-037. Tests:
   `scripts/test-line-discounts.ts` (17 checks), added to `test:unit` with
   `test-old-visits-unchanged.ts`.
