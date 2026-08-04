# Cash Position — "How much money do we have in the bank?"

> **Status: DISCUSSION DRAFT.** Nothing built yet. This captures the problem, the
> proposed approach, and the open questions so we can decide scope before writing code.
> Owner raised it while discussing clinic financial-data onboarding (2026-07-29).

---

## 1. The problem

A clinic that migrates to FlexicaAI has been operating for years and already has money
in the bank / cash drawer. Today FlexicaAI **cannot tell them their bank balance.**

Why: FlexicaAI tracks money **flows** (a "stream"), not a **balance** (a "stock"). From
go-live it records:

- **money in** — patient payments (`patient_payments`, incl. advances)
- **money out** — expenses (`expenses`), doctor payouts (`doctor_payouts`), refunds

…but there is **no opening cash/bank figure**, so every money view starts at zero on
go-live day and reflects only post-FlexicaAI activity — not the clinic's real cash on hand.

### Where this shows up
- Finance → **Profit & Loss** shows profit over a *period* (a flow), not cash held.
- There is **no** "cash position" / "money in the bank" view anywhere.
- Searched: no `cash_position` / `bank_balance` / `opening_cash` / treasury concept
  exists in the codebase (core/billing, core/admin/pnl, expenses, sales).

---

## 2. The insight — import the *balance*, not the *history*

To know the bank balance you do **NOT** need to upload historical transactions. You
need **one number**: the opening cash/bank balance on go-live day. Then:

```
Money in the bank
  =  opening balance (fact, given at onboarding)
   + collections           (patient payments in)
   − expenses
   − doctor payouts
   − refunds
```

FlexicaAI already has **every term except the opening balance**. So the fix is to capture
that one figure — a "fact as given," the same principle as patient `opening_balance`
dues (see `docs/import-plan.md`) — and let FlexicaAI keep the running total.

### Why NOT import transaction history
Importing thousands of old transactions to *derive* the balance would **pollute every
report** (Sales, P&L, Receivables, Revenue shares) by mixing pre- and post-go-live
data, making them meaningless. A single opening figure gives the correct balance with
**zero** report corruption. **Decision leaning: import balances, never history.**

---

## 3. Proposed scope

### Phase 1 — single-number cash position (recommended first)
- **Opening balance**: one figure per clinic, set at onboarding / editable in Finance
  settings. (Column on `clinics`, e.g. `opening_cash_balance` int PKR, + the date it
  applies from, e.g. `cash_opening_at` — go-live day. Alt: a one-row config table.)
- **Cash position view / dashboard card**: `opening + money in − money out = current
  balance`, with the components shown (opening, collected, expenses, payouts, refunds).
- Core-agnostic (a clinic-level money view, not dental-specific); clinic-scoped;
  gated by the existing `finance` feature + an ACL (`finance:view`, reuse existing).

### Phase 2 — per-account (later, only if a clinic needs it)
- Multiple **accounts** (Cash drawer, Bank A, Bank B…), each with its own opening
  balance and running total.
- Tag each `patient_payment` / `expense` / `payout` with an **account** so the split
  is real, and reconcile per account.
- Bigger change (a new `accounts` table + an `account_id` FK on the money tables +
  UI on every money-entry form). Defer until asked.

**Recommendation: build Phase 1 only for now.**

---

## 4. Open questions (to discuss)

1. **Whose money?** Confirmed intent = the **clinic's** cash/bank position, NOT
   FlexicaAI's company treasury. (Owner-side company P&L already exists separately in
   `core/admin/pnl.ts`.)
2. **Single vs per-account** — start single (Phase 1) and add accounts later? Or does a
   real clinic already need Cash-vs-Bank split on day one?
3. **What counts as "money out"?** Confirm the outflow set: expenses + doctor payouts +
   refunds. Anything else (e.g. supplier payments already covered by expenses)?
4. **Advances/credit** — patient advances are cash received (money in) even though not
   yet "earned." They should count toward cash position (they do, as `patient_payments`).
   Confirm that's the intended treatment.
5. **Where is the opening balance set?** Onboarding import (a new one-row "clinic
   financials" step) vs a Finance settings screen vs both.
6. **Reconciliation** — do we need a manual "adjust to match the bank statement" entry
   (an audited correction), or is the derived figure enough for v1?
7. **History/edit safety** — the opening figure changes the whole running balance;
   should it be edit-restricted (clinic admin only) + audit-logged? (Likely yes.)
8. **Reporting window** — cash position is a *point-in-time* number ("as of today").
   Do we also want it "as of a chosen date"? (Derivable, but adds UI.)

---

## 5. Guardrails (unchanged)
- Clinic-scoped (`clinic_id` on everything); every read filters `notDeleted()`.
- Gated by the `finance` feature ∩ an ACL grant.
- Soft-delete on any new ledger rows; opening figure is audit-logged.
- CORE + specialty-agnostic — a dentist, dermatologist, and hair surgeon all use
  "cash position" identically → it lives in `/core`, never a module.

---

## 6. Not in scope (for this feature)
- Uploading historical revenue / expense transactions (see §2 — would corrupt reports).
- Full double-entry accounting / GL. FlexicaAI is a clinic ops tool, not accounting
  software; cash position is a management view, not a bookkeeping system.
- Bank API/statement sync. Manual opening figure only.
