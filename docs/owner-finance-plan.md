# Owner Finance — Company P&L (Revenue · Cost · Expenses · Net Profit)

> Status: **PLAN (not built)**. This is the **COMPANY's** finance — "how much are
> *we* (Klenic) earning?" — the super-admin control plane. It is **distinct from the
> clinic-side Finance v1** (`docs/finance-plan.md`, which is patient billing for a
> clinic). Everything here is **core** (`core/admin/*`, cross-tenant `unscoped`
> reads), gated by new admin ACL capabilities.
>
> **Scope decision (owner, 2026-07-23):** go to **FULL NET PROFIT** — include an
> in-app company operating-expenses ledger, not just variable serving cost. This
> intentionally goes further than `super-admin-plan.md` §5b (which kept company
> opex external); that note is superseded for this build at the owner's direction.
> Reuses: `getCompanyMetrics`, `clinic_payments`, `core/admin/billing.ts`, the clinic
> Expenses patterns (categories + recurring cron), sparkline/report/CSV helpers,
> soft-delete + Trash, and the `revenue:view` ACL pattern.

## 1. The model

```
Company Net Profit  =  Subscription Revenue          (what clinics pay Klenic)
                     −  Variable serving cost         (AI: Whisper + Claude · WhatsApp)
                     −  Operating expenses            (payroll, rent, marketing, …)
```

- **Revenue** — two truths, both shown:
  - **MRR / ARR** = accrual run-rate (Σ active `monthly_price`). *Forward-looking.*
  - **Collected** = cash actually received (`clinic_payments`). *Actuals.*
  - **Net profit is computed on the CASH basis** (collected − cost − opex) for real
    results; MRR is shown alongside as the run-rate. (Decision — see §7.)
- **Variable serving cost** — Klenic's metered spend, the cost of *serving* clinics:
  - **Scribe** (Whisper transcription + Claude note) per visit, **WhatsApp** per message.
  - **v1 = count × unit-rate estimate** (no per-call token/minute log exists yet):
    scribe count from `visits`, WhatsApp count from `whatsapp_messages`, × a
    configurable unit rate. Precise token/minute metering is a later add (§8).
- **Operating expenses** — Klenic's own fixed/variable costs recorded in-app
  (payroll, rent, software/infra, marketing, legal, tax set-aside, …).
- **Gross margin** = Revenue − variable serving cost. **Net profit** = Gross margin −
  operating expenses. **Per-clinic margin** = that clinic's revenue − its serving cost.

## 2. What already exists (reuse, don't rebuild)

- Per-clinic subscription billing (price/cycle/grace/activation, partial payments,
  overdue + follow-ups) — `core/admin/billing.ts`, `clinic_payments`.
- `getCompanyMetrics` — MRR/ARR, collected month/year, collection trend, top clinics,
  overdue (already scoped per team member). **Cost + margin slots are stubbed here**
  awaiting this build.
- Clinic-side `expenses` / `expense_categories` + recurring-expense cron — the
  **pattern** to mirror for company opex (not the same tables).

## 3. Schema (new / changed)

Company-level (most rows have **no `clinic_id`** — they're Klenic's, not a tenant's),
soft-deletable where money-bearing (→ admin Trash), audit-logged.

- **`platform_cost_rates` (new)** — the unit-cost config. `scribe_call_cost`,
  `whatsapp_msg_cost` (and optionally `whisper_minute_cost` if we split), `currency`
  (USD), `usd_to_pkr` FX, `effective_from`, `created_by(+name)`. Keep **rate history**
  (a new row per change) so past periods cost at the rate that was live then. Latest
  row = current rates.
- **`company_expenses` (new)** — the opex ledger. `category_id` →
  `company_expense_categories` (`set null`), `amount` int (PKR), `incurred_on` date,
  `vendor`, `method` (cash/bank/cheque/other), `reference`, `note`, `recurring` bool +
  `recurrence` (`monthly`|`weekly`) + `next_run_on` date, `created_by(+name)`,
  soft-delete. Mirrors clinic `expenses` one tier up. Indexes: `(incurred_on)`,
  `(category_id)`, partial due-index for the recurring cron, partial trash index.
- **`company_expense_categories` (new)** — `name`, `is_active`. Seeded: Payroll,
  Rent, Software/Infra, Marketing, Legal/Professional, Taxes, AI/API, WhatsApp, Other.
- **`clinic_invoices` (new, Phase 4 — optional)** — a numbered subscription
  invoice/receipt Klenic issues *to* a clinic. `clinic_id`, `invoice_no` (company
  sequence), `period_start/end`, `amount`, `issued_at`, `issued_by(+name)`,
  soft-delete. Only if clinics ask for a document; reuses the invoice PDF frame.
- **(Deferred) `ai_usage` (new)** — per-call tokens / audio-minutes for *precise*
  cost. Not v1; the count-based estimate ships first.

## 4. Logic (core/admin)

- **`core/admin/cost.ts` (new)** — `getCostRates()` / `setCostRates(...)`;
  `computeServingCost({ from, to, perClinic })` — counts scribe calls (`visits`) +
  WhatsApp (`whatsapp_messages`) in the period, per clinic and total, × the rate
  effective in that period → estimated cost (PKR). All `unscoped`, grouped in SQL.
- **`core/admin/company-expenses.ts` (new)** — `record` / `edit` / `void`
  (soft-delete) / list + filters; categories CRUD; the recurring-expense cron
  (`GET /api/cron/company-expenses`, reusing the clinic recurring pattern). Audited.
- **`core/admin/pnl.ts` (new)** — `getCompanyPnl({ from, to })` → revenue (collected +
  MRR run-rate) − serving cost − opex = **net profit**, plus gross margin, margin %,
  per-clinic margin, and monthly trend buckets. One `unscoped` block.
- **`core/admin/metrics.ts` (extend)** — fold serving cost + gross margin into the
  existing dashboard now that the cost side exists (fills the stubbed slots).

## 5. UI (`/admin/finance` — new nav section)

- **`/admin/finance`** — the **Company P&L** dashboard: Revenue (MRR + Collected),
  Variable cost, Operating expenses, **Net profit** (headline), gross margin + margin
  %, and a revenue-vs-cost trend chart. Period filter (this month / quarter / year /
  custom), reusing the report range helpers.
- **`/admin/finance/costs`** — unit-cost config (edit rates + FX) + the usage/cost
  breakdown: cost per clinic, top cost centres, scribe vs WhatsApp split.
- **`/admin/finance/expenses`** — the company opex ledger: record/edit/void, category
  filter, date range, recurring, CSV export. (Clinic-Expenses UX, company-level.)
- **Clinic detail** — a small **per-clinic margin** card (its revenue − its serving
  cost) so you can spot a clinic that costs more than it pays.
- **Export** — a period **CSV** (revenue, serving cost, opex by category, net profit)
  to hand your accountant. Generic now; QBO/Xero template slot later (as agreed).

## 6. Access control

Company financials are the most sensitive data in the platform → gate tight, but
grantable (e.g. to a finance/accountant team member).

**Split into FOUR independently-grantable admin resources** (originally one `finance`
resource; split so, e.g., a bookkeeper can manage expenses without seeing the P&L):
- **`pnl`** (view) — the P&L dashboard (`/admin/finance`) + CSV export.
- **`serving_cost`** (view, edit) — the cost page (`/admin/finance/costs`); edit = unit rates.
- **`expenses`** (view, create, edit, delete) — operating expenses (`/admin/finance/expenses`).
- **`sub_invoices`** (view, create, delete) — subscription invoices (`/admin/finance/invoices`);
  create = issue, delete = void.

- **Default:** owner + super_admin hold all four; support/sales/billing do **not** (but
  the owner can grant, say, just `expenses:*` to an accountant login). Each finance nav
  subtab gates on its own `*:view`. Same **data backfill** as `team`/`revenue` — the
  split mapped every explicitly-full super_admin's old `finance:*` to the four new
  resources.
- `revenue:view` (MRR/ARR + serving-cost/margin KPIs on the main dashboard/Overview)
  is separate and unchanged. Everything audit-logged; company expenses soft-delete to
  their own ledger/Trash.

## 7. Decisions to confirm at build

1. **Net-profit basis** — cash (Collected) vs accrual (MRR). *Recommend:* actuals on
   Collected, MRR shown as run-rate.
2. **AI cost accuracy** — count-based estimate (v1) vs add `ai_usage` token/minute
   logging. *Recommend:* estimate first; add metering when AI goes live at volume.
3. **ACL** — new `finance` resource (recommended) vs folding into `revenue:view`.

## 8. Build phases

1. **Cost tracking** ✅ — `platform_cost_rates` (migration 0057) + `core/admin/cost.ts`
   (`getCostRates`/`setCostRates`/`computeServingCost`) + `/admin/finance/costs` (rate
   config + this-month cost KPIs + per-clinic breakdown). New `finance` ACL resource
   (view/create/edit/delete); nav item on `finance:view`. *The deferred "Feature 7."*
   Verified over HTTP: ACL (owner/full · finance:view read-only · no-finance bounced),
   save action writes a new rate version, compute matches counts×rates per clinic.
2. **Company opex ledger** ✅ — `company_expenses` + `company_expense_categories`
   (migration 0058) + `core/admin/company-expenses.ts` + `/admin/finance/expenses`
   (filters: period/category/method/search/Trash · **graphs:** monthly trend
   MultiBarChart + by-category HBarChart · add/edit/delete-soft + restore · category
   mgmt) + recurring cron (`/api/cron/company-expenses`, vercel.json). Gated
   `finance:view` (page) / `finance:create|edit|delete` (mutations). Verified over
   HTTP: ACL 4 roles, period/category/method/search filters, both graphs, soft-delete
   → Trash → restore, recurring cron generates a copy.
3. **Company P&L dashboard** ✅ — `core/admin/pnl.ts#getCompanyPnl` (collected
   revenue − serving cost − opex = net profit, on the cash basis; gross margin,
   margin %, per-clinic margin, and a zipped revenue/cost/profit trend; MRR/ARR
   run-rate alongside) + `/admin/finance` (headline net profit + component KPIs +
   `MultiBarChart` trend with a status-coloured profit series + per-clinic margin
   table, lowest first) + **CSV export** (`/api/admin/finance/pnl/export`, BOM,
   summary + per-clinic + trend, 403 without `finance:view`). Period filter (reuse
   `CostFilters`); MRR/ARR gated on `revenue:view`. **Verified over HTTP:** net
   profit matches DB totals (Rs 19,654 = 30,000 − 346 − 10,000, 65.5% margin);
   per-clinic margins (negatives first); MRR gate; CSV + 403; page bounces without
   finance:view. **Serving cost + gross margin folded into the main `/admin`
   dashboard** ✅ — `getCompanyMetrics({ withCost })` adds this-month serving cost +
   gross margin (collected − serving cost) KPIs, computed only when the viewer holds
   `revenue:view` (same gate as MRR/ARR; skipped otherwise to save the queries),
   scoped to the assignee like the rest. Verified: owner sees Serving cost Rs 382 /
   Gross margin Rs 19,618 (= collected 20,000 − 382); a metrics-only user sees neither
   (no leak).
4. **Company invoices/receipts to clinics** ✅ — `clinic_invoices` + `company_settings`
   (company-global invoice counter + prefix, migration 0059) + `core/admin/clinic-invoices.ts`
   (issue under a row lock, list/void/restore, invoiced total + trend, print) +
   `/admin/finance/invoices` (filters: clinic/period/Trash · **graph:** invoiced trend ·
   issue form that pre-fills the clinic's monthly price · ledger with a **printable
   receipt** reusing `InvoicePrintFrame` + void/restore). Gated `finance:view` /
   `finance:create` (issue) / `finance:delete` (void). Verified over HTTP: ACL 4 roles,
   sequential numbering (KL-INV-1/2, counter→3), list+total+trend, print (bill-to clinic
   + owner, Klenic issuer) + print gated, clinic filter, void→Trash→restore. **Clinic
   refund/credit** ✅ (migration 0060) — `clinic_payments.kind` (`payment` +balance
   +cash · `refund` −balance −cash · `credit` +balance non-cash); balance math +
   `recordClinicPayment` are sign/kind-aware (refund/credit carry 0 months); the clinic
   Billing card gains a Type select + refund/credit history badges + signed amounts.
   **Collected revenue is now CASH-aware everywhere** — `getCompanyPnl` +
   `getCompanyMetrics` count payment − refund and exclude non-cash credit.

**Precise token/minute AI metering** ✅ (migration 0061) — `ai_usage` (one whisper
row [audio seconds] + one claude row [in/out tokens] per scribe run, `cost_pkr`
snapshotted at record time); the scribe engine now returns Whisper `duration`
(verbose_json) + Claude `message.usage`, and the scribe route records it best-effort
(`core/ai/usage.ts`). `platform_cost_rates` gained `whisper_minute_cost` /
`claude_input_cost` / `claude_output_cost` (per 1M). `computeServingCost` + the
dashboard now use **metered** AI cost (Σ `ai_usage.cost_pkr`), falling back to the flat
`scribe_call_cost` estimate only for an audio visit with no metered row. Verified:
rate form saves the metered rates; a metered visit (whisper 3 + claude 13) + an
un-metered one = Rs 19 on the costs page; dashboard metered-aware.

**Deferred:** plans/tiers + entitlements + automated dunning (v3), multi-currency
beyond one FX rate, automated tax computation, QBO/Xero-specific export templates
(generic CSV ships first).

## 9. Definition of done

- `/admin/finance` shows Revenue − Serving cost − Operating expenses = **Net profit**,
  with gross margin, margin %, per-clinic margin, and a trend — for any period.
- Unit-cost rates are configurable (with history) and drive per-clinic + total serving
  cost from real usage counts.
- Company operating expenses are recordable (categories, recurring, void→Trash) and
  flow into net profit.
- The whole section is gated by the new `finance:*` capabilities (owner + super_admin
  default, grantable), clinic-data-free (company-level), and CSV-exportable.
- All core, cross-tenant reads `unscoped`, audit-logged, soft-delete + Trash; tsc
  clean; verified end-to-end over HTTP.
