# Overview report ("Day report") — plan

> **Status: BUILT (2026-07-17).** `/clinic/overview` — `core/finance/overview.ts` +
> the page + a dashboard "Day report" button + a Reports-hub card, all as planned. All
> reconciliation invariants (§8) DB-verified across every clinic; unit 33/33; e2e 61/61.
>
> Original plan below. A one-click,
> period-scoped consolidated report — "how did the day (or period) go?" — reachable
> from a **"Day report"** button on the dashboard + a card in the Reports hub. Owner
> decision (2026-07-17): build this as **Overview**, NOT by overloading the Day Book;
> the Day Book stays the clean cash record and appears as one section here.

## 1. The one correctness rule: two bases, never blended

The single most important thing to get right — the same cash-vs-accrual tension the
discount-bearing work navigated:

- **Performance / accrual — bucketed by the VISIT date** (`appointments.scheduled_at` =
  the ledgers' `occurred_at`). "Today's sales / discounts / doctor shares / profit" =
  what the visits **scheduled today** produced.
- **Cash — bucketed by the PAYMENT/expense date** (`patient_payments.occurred_at`,
  `expenses.incurred_on`). "Today's cash" = money that actually **moved today**.

A payment taken today for yesterday's visit is **today's cash** but **yesterday's
sale** — so the two bases must live in **separate, clearly-labelled sections** and are
**never summed into one number**. The top summary is entirely performance-basis; cash
lives in its own **Cash** section.

## 2. Reuse the tested cores — the Overview invents NO money logic

Every figure comes from an existing, tested report core, called with the same range —
so the Overview **reconciles exactly** with each standalone report (a testable
invariant: Overview's Sales total == the Sales report's for the same range, etc.).

| Section | Source core | Basis |
|---|---|---|
| Sales / collected, by doctor, by procedure | `getSalesReport(range, doctorId?)` | visit |
| Discounts given · borne-by · pending | `getDiscountsReport(range, {doctorId})` | visit |
| Doctor shares — per doctor (earned / borne / net) | `getSharesReport(range, doctorId?)` | visit |
| Expenses (total + by category) | `getProfitAndLoss(range)` (`expenses`, `byExpenseCategory`) | incurred |
| Net profit (revenue − shares − expenses) | `getProfitAndLoss(range)` | visit |
| Cash in / out / net (by method) | `getDayBook` → **new range variant** | payment |
| Waivers given | **new** small aggregate over `doctor_settlement_actions` | action date |

Small core additions needed (additive, no schema change):
- `core/finance/daybook.ts` — a **range** cash summary (`getCashSummary(clinicId, range)`
  → collections / refunds / expenses / net, by method) so Cash isn't single-day only.
- `core/sales/share-report.ts` — extend `DoctorShareRow` with `grossEarned` + `borne`
  (it already computes shares vs settlements separately before folding) so the
  per-doctor section can show **earned / borne / net**, not just net.
- `core/sales/settlement-actions.ts` — a range total of waives (doctor_waive +
  clinic_waive) for the "Waivers" figure.

## 3. Sections (top → bottom)

1. **Summary cards** (performance basis): **Collected** · **Discounts given** ·
   **Waivers** · **Doctor shares** · **Expenses** · **Net profit** (red on a loss).
   *No cash figure here* — cash is its own section.
2. **Money flow** — a **waterfall** (`WaterfallChart`): **Collected → −Doctor shares →
   −Expenses → Net profit**. Exact (`collected − shares − expenses = profit`); the
   share step is the P&L cost `collected − expenses − profit` (net of waivers) so the
   bars land on Net profit; the result bar is green (profit) or red (loss). Discounts
   are shown separately (money never collected). *The same waterfall, scoped to TODAY,
   is a compact "Today's money flow" card on the **dashboard** (finance-gated) with a
   "Full day report →" link — the one Overview taste that the KPIs don't already show.*
3. **Cash** — money in/out by method (collections − refunds − expenses = net cash),
   from the range cash summary. Clearly headed "Cash that moved" so it's never confused
   with collected revenue.
4. **Doctor shares — per doctor** — table + `HBarChart` of net per doctor: each
   doctor's **earned · discount-borne · net · # visits**. This is the owner's
   "what each doctor earned" view.
5. **Discounts & waivers** — totals + the per-visit list (reuse the Discounts report's
   rows: patient · doctor · borne-by · split · approver · applied/pending).
6. **Sales** — by doctor / by procedure (the Sales report's `HBarChart`s).
7. **Expenses** — by category (`HBarChart`).

Every list is **dual-render** (desktop table + mobile cards) per the app convention;
charts are already responsive.

## 4. Filters, print, export

- **Filters**: **date (default TODAY)** + custom **range** + **doctor** — reuse the
  sales-filters period/range pattern with a "today" default. The doctor filter scopes
  the **performance** sections (sales / shares / discounts are doctor-aware); the
  **Cash** section shows all cash (payments aren't doctor-tagged) and is hidden or
  labelled "all doctors" when a doctor is selected.
- **Print / Save-PDF** — the primary export (an end-of-day artifact), with the same
  print CSS the doctor statement uses (drop the shell chrome).
- **CSV** — the individual sections already export via `/api/finance/export`; the
  Overview links through to them rather than inventing a single messy multi-section CSV.

## 5. Access control

Gated by the **`finance` feature + `finance:view`** permission — the same gate as
P&L, since the Overview is "P&L plus detail" (it surfaces profit, per-doctor shares,
discounts). Clinic admin holds it by default; grantable to a manager. The dashboard
**"Day report"** button and the Reports-hub card use the same gate, so a user who
can't see it never sees the entry point. (Clinics without the finance feature keep
using the individual Sales / Discounts / Shares reports.)

## 6. Performance

All cores run in **one `Promise.all`**; each is a range-bounded, indexed scan. For the
default single day this is cheap. There is minor redundancy (P&L and Sales both scan
`sales`; P&L and Shares both scan `sale_shares`) — acceptable for a report, and it
keeps the numbers guaranteed-consistent with the standalone reports. If a wide range
ever proves heavy, fold the shared scans later; do **not** duplicate the money logic to
save a scan.

## 7. Placement & naming

- Page: **`/clinic/overview`**. Title "Overview" (subtitle "Your clinic's day, end to
  end").
- **Dashboard**: a prominent **"Day report"** button (top of the page) → `/clinic/overview`
  (defaults to today) — this is the owner's one-click entry.
- **Reports hub**: an "Overview" card.
- The existing **Day Book** page stays as-is (the focused cash-only view); the Overview
  links to it from its Cash section.

## 8. Edge cases

- **Empty period** → per-section empty states; summary shows zeros.
- **Doctor filter** → performance sections scope to that doctor; Cash section shows all
  (labelled) since payments aren't doctor-attributed.
- **Loss** → Net profit card + the "where the money went" profit segment go red.
- **Timezone** → day bounds use the server's local tz (existing deploy caveat).
- **Reconciliation invariant** (test): for a given range, Overview.sales ==
  Sales-report total; Overview.doctorShares == Shares-report `shareTotal`;
  Overview.netProfit == P&L `netProfit`; Doctor shares + Expenses + Net profit ==
  Collected.

## 9. Phasing

1. **Core** — `getOverview(clinicId, range, doctorId?)` composing the cores + the range
   cash summary + waivers/per-doctor-borne additions. Returns one structured object.
   DB-test the reconciliation invariants (§8).
2. **Page** — `/clinic/overview`: summary cards, "where the money went" chart, Cash,
   per-doctor shares, discounts & waivers, sales, expenses — dual-render + print CSS.
3. **Filters** — date (default today) + range + doctor.
4. **Access + entry points** — `finance`/`finance:view` gate; dashboard "Day report"
   button + Reports-hub card.
5. **Print** (+ links to per-section CSVs).

Each phase: DB-tested, `tsc` clean, `e2e` green — same bar as the rest of the app.

## 10. Open questions (confirm before build)

1. **Gate** — `finance:view` as proposed (P&L-level), or a lighter gate (e.g. `sales`)
   so more staff can see it? *(Recommend `finance:view` — it exposes profit + per-doctor
   earnings.)*
2. **Where-the-money-went chart** — the 3-segment breakdown (Doctor shares / Expenses /
   Profit) as proposed, or a stepped **waterfall** (Gross → −Discounts → −Shares →
   −Expenses → Profit)? *(Recommend the 3-segment `HBarChart` — exact, reuses an
   existing component; a waterfall is a new component for marginal gain.)*
3. **Range or day-only** — support the custom range (recommended, cheap), or lock it to
   a single day to match the "end of day" mental model?
