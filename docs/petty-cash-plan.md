# Petty Cash — "does the money in the box match the system?"

> **Status: BUILT 2026-09-23.** Owner raised it 2026-09-22 and chose the shape: **one
> shared drawer per clinic, counted at shift handover.** Shipped as `/clinic/cash`,
> `core/finance/petty-cash.ts`, migrations `0109`–`0113`, `scripts/test-petty-cash.ts`.
>
> **This file is now a plan that was FOLLOWED, not a live contract** — the code wins,
> then `.claude/architecture.md` (ADR-034) and `.claude/database.md`. It is kept for the
> reasoning: why a reconciliation rather than a second ledger, why the float carries
> forward from the COUNT, and the open questions in §8 that are still open. Where the
> build departed from the plan it is marked inline (see §5).
>
> Sibling of `docs/cash-position-plan.md` (money in the BANK); read that too — §7
> explains how the two relate and why neither blocked the other.

---

## 1. The problem

A clinic runs a cash box at the front desk. Money goes in all day (patients paying
cash), money comes out (a courier, gloves, tea, a doctor's share paid in notes), and
at some point somebody opens the drawer and counts it. **FlexicaAI cannot tell them
what should be in there**, so the count is compared against nothing and a shortfall
is invisible until it is large enough to notice by feel.

## 2. The insight — this is not a ledger, it is a reconciliation

Cash movements are **already recorded**. `method = 'cash'` is a grouping label on
three clinic-scoped ledgers:

| | table | direction |
|---|---|---|
| in | `patient_payments` (`kind`: payment / advance) | + |
| out | `patient_payments` (`kind`: refund) | − |
| out | `expenses` | − |
| out | `doctor_payouts` | − |

A new "petty cash transactions" table where someone types *"paid 500 for gloves"*
would be a **second place a cash expense can live**. The day book, the P&L and the
cash box would then disagree with no way to tell which is right — the exact failure
ADR-015 exists for, and the reason `imported_transactions` was built as a read-only
archive that never joins a live report. **A cash purchase stays an expense, recorded
once, in `expenses`.**

**NOT clinic money, and must never be read here:** `clinic_payments` and
`company_expenses` are FlexicaAI's own books (Owner Finance). That money never
touches a clinic drawer.

## 3. What is genuinely missing — two stored facts

Everything else is a read. Only these cannot be derived:

1. **The count.** What is physically in the box. Only a human knows this, and the gap
   between counted and expected is the entire point of the feature.
2. **Cash leaving the drawer that is not a cost.** A bank deposit, or the owner taking
   the day's takings, or topping the float up. Today this has nowhere to go, so an
   expected balance would climb forever. It must NOT be an expense: moving money
   between your own pockets is not a cost, and filing it as one would corrupt the P&L.

### The float carries forward from the COUNT, not the expectation

```
expected_now = last count's COUNTED total
             + Σ cash in      (after that count)
             − Σ cash out     (after that count)
             − Σ transfers out (after that count)
```

Reality is re-based at every count. A one-off 500 shortfall is recorded, explained and
**absorbed** — it does not poison every future expected figure. Carrying the *expected*
total forward instead would make one bad Tuesday wrong forever.

### The first count is the opening float

No new `clinics` column and no dependency on the cash-position plan: the first count
says "there is 5,000 in this box", its expected total is undefined and its variance is
NULL. Every later count reconciles against its predecessor. (An earlier version of this
recommendation said cash-position Phase 1 was a prerequisite. It is not — see §7.)

## 4. Proposed schema

### `cash_counts` — a handover
`id`, `clinic_id` → clinics (cascade), `counted_at` timestamptz, `counted_total` int
PKR, **`expected_total` int (SNAPSHOT)**, **`variance` int signed (SNAPSHOT, NULL on
the first count)**, `note`, `counted_by` uuid (no FK — users soft-delete) +
`counted_by_name` snapshot, soft-delete columns, timestamps.

**Why expected and variance are stored, not derived.** A count is a FACT about a
moment ("Asma counted 11,500 at 18:04"). The expected figure at that moment is derived
— but if it is recomputed later, a back-dated cash expense silently rewrites a variance
somebody already signed off, and a voided `doctor_payouts` row (which is **hard**
deleted today, §6) changes it with no trace at all. Same reasoning as `sales`
snapshotting its amounts and `sales.doctor_name` (ADR-016).

### `cash_transfers` — money out of the drawer that is not a cost
`id`, `clinic_id` (cascade), `kind` (→ new `cash_transfer_kinds` vocabulary),
`amount` int PKR **always positive** (direction carried by `kind`, like
`patient_payments`), `occurred_at`, `reference`, `note`, `created_by` + name snapshot,
soft-delete, timestamps.

`cash_transfer_kinds` as a reference table with ids written out (ADR-027), because a
wrong value here produces a wrong FIGURE silently — which is exactly that ADR's test:
`bank_deposit` (out), `owner_draw` (out), `float_topup` (in).

### One formula, one place
`core/finance/petty-cash.ts` owns `expectedInDrawer(clinicId, since)` and nothing else
recomputes it (ADR-015).

## 5. Scope

**Phase 1 (recommended, all of it):** record a count, show expected vs counted with the
components that produced it, record a transfer, list the count history with variances.
Clinic-scoped, gated by the `finance` feature.

**Not phase 1:** a variance TREND report across people and weeks. It is the part that
reads as surveillance, and it should be decided deliberately rather than arrive as a
side effect.

### The history lists this page's own records only (owner's call, 2026-09-23)

The drawer history briefly also listed the cash rows borrowed from the other ledgers —
a cash payment, a refund, a cash expense, a doctor paid in notes — read-only, with a
link to the screen that owned each. The argument for them was traceability: the working
says Rs 2,500 left, and the history could say which 2,500.

**Removed at the owner's direction.** A payment belongs to Payments and an expense to
Expenses; reprinting them here made one page look like two, and the link went to the
owning LIST rather than the entry, so "Open" promised more than it delivered.

**What did NOT change is the figure**, and the distinction is the whole point. The
patients' cash physically goes into this same drawer, so `getDrawerState` still counts
every cash payment, refund, expense and payout — it computes its own sums and never
read the list. Removing the rows from the sum as well would have shown a false
shortfall at every handover.

**One exception, and it proves the rule rather than bending it: a "Paid for something"
typed at the drawer IS this page's own record**, so it is listed and editable here
(added the same day). Nothing distinguished it from any other cash expense, so
`expenses.from_drawer` (migration `0112`) says where a row was typed — and only that.
The expense is otherwise completely ordinary: in the P&L, in Expenses, in every report,
none of which know the column exists. An expense typed on the Expenses screen is still
not listed here, in cash or not, today or not.

The drawer's edit of one is narrow in three ways, all in the WHERE clause: only
`from_drawer` rows, only amount and note (reusing `updateExpense` would blank the
category and vendor this form never shows — a form may only write what it displays),
and only your own unless you are the clinic admin. It needs the `expenses` grant on top
of `cash`, because being able to record a shortfall is not authority to change a cost.

So the working is now the only explanation of the figure for everything else, which
raises what it owes: a
named line per kind with its reasons underneath ("Paid out in cash − Rs 2,500 · gloves
· courier"). That is the aggregate answer where the rows were the itemised one, and it
is why `reasons` exists on `CashMovement`. If an aggregate line ever proves too coarse
to settle a variance, the itemised answer belongs behind that LINE — expanding in
place — not as rows in a history of records this page does not own.

## 6. Three hazards in the existing data

These are not hypotheticals; each would produce a wrong drawer figure.

1. **Every `method` column is nullable**, and `normalizePaymentMethod` folds NULL into
   `other`, not `cash`. A cash expense saved without a method silently vanishes from the
   drawer and reappears as an unexplained shortfall. **Recommendation:** do not guess and
   do not silently exclude — the count screen shows a *"not attributed to a tender"*
   line, so the reader sees why the numbers differ instead of doubting the person who
   counted.
2. **`advance_applied` inflates `collected`** in the day book (documented at
   `daybook.ts:80-88`). Harmless here by construction — it carries `method = 'advance'`,
   which is `is_tender = false` — provided the drawer filters on the tender flag rather
   than on "not bank, not cheque".
3. **`doctor_payouts` has no soft-delete columns and `voidPayout` really deletes**
   (`payouts.ts:250`). A voided payout leaves no trace, so the expected figure changes
   retrospectively. Snapshotting (§4) survives it, but the underlying gap in ADR-006
   should be fixed on its own merits, not by this feature.

**Also worth fixing first, independently:** the day book's **"Net cash" card is not
cash** — `totals.net` sums every method (`daybook.ts:105-113`, `daybook/page.tsx:96`),
so bank transfers and cheques are inside a figure a person would read to decide what
should be in the drawer.

## 7. Relationship to `cash-position-plan.md`

They answer different questions and **neither blocks the other**:

- **Cash position** = "how much money do we have" (bank + cash), needs one opening
  figure, is a *stock* derived from flows.
- **Petty cash** = "does the box match", needs a count, is a *reconciliation*.

They meet at cash-position Phase 2 (an `accounts` table, one of which is the drawer).
If both are built, the drawer becomes one account and its expected balance is the same
arithmetic. Building petty cash first does not foreclose that.

## 8. Open questions

1. **Does a count FREEZE its window?** If Tuesday's count is signed off at 11,500 and
   someone then back-dates a cash expense into Tuesday, the snapshot keeps the old
   variance — correct — but the *next* count's opening no longer matches reality. Either
   counts lock the period, or the drift is surfaced and explained. Leaning: surface it,
   because refusing a late entry makes people record it wrongly instead.
2. **Who sees a variance?** Counted and expected must be visible to whoever counts —
   they can subtract. The sensitive artefact is the HISTORY across people (§5). A new
   `cash` resource (view / create) for the front desk, with the trend report under
   `finance:view`? Note `finance` is **view-only** today, so accepting a count needs a
   new resource or widening it.
3. **Default holders:** receptionist + manager + clinic_admin create counts; doctor
   never. Confirm — and note that any new `PERM_RESOURCES` entry ships with a backfill
   migration in the same commit or it is a silent revocation (ADR-033).
4. **One count per handover, or one per day?** Chosen: handover. Does the UI need to
   know the shift boundaries (from `users.availability`), or is "whenever someone
   counts" enough? Leaning: enough — a count carries a timestamp and a person.
5. **Rounding / notes denominations?** Counting by denomination (10 × 1000, 6 × 500…)
   catches arithmetic slips and is how a real handover is done. Worth it for v1, or is
   one total enough?

## 9. Guardrails (unchanged)

- Clinic-scoped (`byClinic()` on every query); every read filters `notDeleted()`.
- Soft-delete on both new tables; a deleted count is a money record and belongs in Trash.
- Vocabulary ids written out, never renumbered (ADR-027).
- The transfer ledger is **never** joined into the P&L or the sales report — it is not
  income and not a cost. Say so in the module docblock, because the next person will
  reach for it.
- CORE and specialty-agnostic: a dentist, a dermatologist and a hair surgeon all run a
  cash box identically → `core/finance/`, never `src/modules/`. ("Module" in this
  codebase means a specialty.)
- A drawer is **per clinic**, which is per branch by construction: there is no branch
  concept, and a multi-site group is already N clinic rows.

## 10. Not in scope

- Double-entry bookkeeping or a general ledger. FlexicaAI is a clinic ops tool.
- Bank statement sync or any bank API.
- Per-person floats. Explicitly rejected 2026-09-22: a shared front-desk drawer is what
  a single-site clinic runs. Revisit only if a clinic asks to attribute shortfalls to
  an individual, which is what per-person floats are actually for.
