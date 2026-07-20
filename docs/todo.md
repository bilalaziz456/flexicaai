# Klenic — Task Tracker (Completed + Remaining)

> Updated 2026-07-17. The CLAUDE.md §11 MVP (steps 1–12) is complete. This tracks
> post-MVP work: ✅ = shipped, [ ] = remaining. Roughly ordered by product value.

---

## ✅ Completed (post-MVP)

### Access control & workspace
- [x] **Per-user ACL / permissions** — two-tier (super-admin→clinic, clinic-admin→
      per-user `resource:action`), `manager` role, role defaults, permissions grid.
- [x] **Unified `/clinic` workspace** — all clinic staff share it; nav + pages gate on
      permissions (`requireWorkspace`); `/doctor` + `/reception` folded in.
- [x] **Leave ACL** — doctors self-manage their own leave (dashboard card); add/edit/
      delete gated; step-up password on leave delete.

### Sales
- [x] **Sales feature** — priced procedures, appointment line-items (qty + discounts),
      realised-revenue `sales` ledger (collected basis), `/clinic/sales` report +
      dashboard card, optional consultation fee. Gated by the `sales` feature.

### Finance & billing (money collected = revenue) — 0039–0040
- [x] **Patient payments ledger** (`patient_payments`) — record a payment / advance /
      advance-applied / refund against an appointment or patient; method + reference +
      note; void = soft-delete; `amount_collected` cache recomputed from the live ledger.
- [x] **Partial payments + per-patient outstanding / credit** — collect any amount;
      patient advance credit; the appointment Payment panel + patient account.
- [x] **Numbered invoices** (`invoices`) — per-clinic sequence + prefix, one live invoice
      per visit, **printable (thermal / A5 / A4)**; Invoices register (`/clinic/invoices`)
      with lookup + reprint + CSV.
- [x] **Receivables report** (`/clinic/receivables`) — who owes us, by patient, drill-in
      to visits, filters + CSV; reconciles with the dashboard Outstanding KPI.
- [x] **Expenses** (`expenses` + categories, 0040) — add/edit, categories, filters,
      totals; `finance` feature + `expenses` permission.
- [x] **Profit & Loss** (`/clinic/pl`) — collected revenue − doctor shares − expenses,
      over time, breakdowns; `finance` feature.
- [x] **Reports hub + Day book + CSV export** — `/clinic/reports`, day's cash in/out by
      method, `/api/finance/export`.
- [x] **Owner dashboard finance KPIs** — Collected / Net profit (30d) + Outstanding /
      Payable balances, each with a sparkline (Outstanding = running receivable balance).

### Doctor↔clinic revenue share + discount bearing — 0033–0042
- [x] **Revenue share** — per-doctor consultation/procedure %, `sale_shares` ledger,
      `/clinic/shares` (Earned/Paid/Outstanding), amount-based **payouts** + printable
      statement, per-procedure % overrides.
- [x] **Discount bearing & settlement** — whoever bears a discount absorbs it fully (no
      spillover), balances may go **negative** (a doctor can owe); accrual settlement at
      completion (`discount_settlements`), gross-% earnings, converges to make-whole as
      the patient pays; pure `computeBearing` (33 unit tests). Split control on the
      appointment form (% / Rs, live preview).
- [x] **Settlement actions** (`doctor_settlement_actions`) — bidirectional waives (amount
      on `/clinic/shares` + **per-line** on the appointment detail, re-synced with
      collection), doctor→clinic repayments, write-offs, reversals; `share_waive` ACL.
- [x] **Discount approvals** — per-party sign-off gated by `discount_needs_approval`
      switches; only the bearing party approves (split-portion aware).
- [x] **Discounts report** — every discount, borne-by, clinic/doctor split, approver.

### Reporting & data-viz
- [x] **Overview ("Day report")** (`/clinic/overview`) — one-click day/period report
      composing every core; performance vs cash kept separate; per-doctor shares,
      discounts, sales, expenses, waterfall "money flow"; "Day report" button on the
      dashboard; `finance:view` gated.
- [x] **Chart variety** — matched form to data: area (trends), horizontal ranked bars
      (breakdowns), grouped bars (P&L), earned-vs-paid + cumulative line (shares),
      **waterfall** (money flow), **sparklines** (KPIs). Palette validated (CVD-safe,
      dashed line for the close pair).

### Doctor scheduling
- [x] **Working hours + daily cap + consultation fee**, one `checkDoctorSlot` validator;
      **doctor leave / vacation** (cancels + blocks); patient queue tokens (FCFS per
      visiting window).

### Soft delete + Trash (nothing is hard-deleted) — 0027
- [x] Schema (soft-delete columns + retention), query layer (`notDeleted()` everywhere,
      cascade-hide, sales voided), Trash UI (`/clinic/trash` + `/admin/trash`, Restore,
      super-admin legal purge, filters).

### Per-clinic WhatsApp numbers (Meta Cloud API) — built; live pending Meta setup — 0029
- [x] Schema/config, provider dispatcher + `cloud.ts`, send-from-clinic-number +
      signature, inbound webhook (`/api/whatsapp/cloud`), super-admin + clinic-admin UI,
      `docs/whatsapp-cloud-plan.md`. **Go-live is external (see §E).**

### WhatsApp appointment lifecycle
- [x] Booking confirmation / cancellation / day-before reminder cron; patient
      self-service reschedule + new booking over inbound replies.

### Smaller items
- [x] Patient "Reference" (referred-by) field (0028); age-based DOB entry; profile
      pictures / `/account` self-service; activity log + permission-based access.
- [x] Themed native controls (date picker, selects, scrollbars); dashboard Revenue-
      recovered hero at top; whole-card-clickable report cards; app-wide horizontal-
      scroll fix; From/To date filters on one row across every filter bar.

---

## 🚧 Remaining

### A. Payments gateway & SaaS (money movement is built; integrations are not)
- [ ] **Online payment gateways** — `/core/integrations/payments` still empty; no
      JazzCash / Easypaisa / Raast / Stripe. (Manual payment recording, receipts,
      partial payments + outstanding are DONE — see Finance & billing above.)
- [ ] **SaaS billing & usage (super admin)** — per-clinic billing, plans, usage metering.
- [ ] **Marketing site** — `/(marketing)` (landing, pricing, SSG); only `(auth)` exists.

### B. Platform / infrastructure
- [ ] **Email notifications** — `core/notifications/` is WhatsApp-only (no password-reset
      / staff-invite email). `CLAUDE.md §3` wants email + in-app alerts.
- [ ] **In-app notifications** — no bell/alerts.
- [ ] **Postgres RLS** — tenant isolation is query-layer only (`byClinic()`).
- [ ] **Rate limiting** — none on login / general traffic.
- [ ] **Load / scaling hardening** — bcryptjs blocks the event loop; pool `max:10`; no
      connection pooler.
- [ ] **File storage = local disk** — `core/integrations/storage` is local FS; ephemeral
      on Vercel. Needs S3-compatible swap BEFORE deploy.

### C. Dental clinical depth (dental module is still a thin shell)
- [ ] **Tooth chart / odontogram** + a `dental_records` table linked to `visits`
      (neither exists; scribe dumps generic JSONB into `visits.note`).
- [ ] **Treatment plans** — `treatment-templates.ts` never created; no `treatmentTemplates`
      in `ModuleDefinition`; no multi-visit planning.
- [ ] **Clinical imaging / X-ray / photo attachments** (+ consent-tracked photo use).
- [ ] **Lab-work tracking** (crowns/dentures).

### D. Clinic-operations
- [ ] **Standalone prescription history** — per-patient Rx list/reprint page.
- [ ] **Reporting beyond finance** — no-show rate, utilization, doctor productivity,
      recall-effectiveness. (Sales / Discounts / Shares / P&L / Receivables / Day book /
      Overview are DONE.)
- [ ] **Inventory / payroll / attendance**. (Expenses is DONE.)
- [ ] **Recurring-expense automation** (cron); global-Trash wiring for expenses.

### E. WhatsApp Cloud API — go-live (external, code is done)
- [ ] Meta Business account + verification + WABA + system-user token.
- [ ] Set `WHATSAPP_PROVIDER=cloud` + token / WABA id / verify token / app secret; point
      Meta's webhook at `/api/whatsapp/cloud`.
- [ ] Create + get the 7 Utility templates approved (`docs/whatsapp-cloud-plan.md` §C).
- [ ] Decide the "always-present variable" handling (docs §D).
- [ ] Provision a pilot clinic's number → live send/receive test → roll out.

### F. Future specialty modules (architected for; NOT to build without instruction)
- [ ] **Derma module** · [ ] **Hair-transplant module** — touch only `/modules/<id>` +
      the registry, zero core changes.

### Cleanup
- [ ] **Dead dental nav config** — `dental/config.ts` `navItems` point at old `/doctor/*`
      routes; unused now that `PanelShell` drives nav. Remove/repoint.
- [ ] **Dead route pages** — the folded-in `/doctor` + `/reception` `page.tsx` redirect
      stubs can be removed.
- [ ] Clean orphaned test users (clinic_id NULL non-super-admin rows from verify scripts).

---

## Suggested priority order (toward "sellable")
1. **Online payment gateways** — JazzCash / Easypaisa / Raast / Stripe (billing core is
   done; this makes collection self-serve).
2. **Dental clinical model** — tooth chart + `dental_records` + treatment plans.
3. **Email + in-app notifications** — onboarding, password reset, alerts.
4. **Deploy hardening** — S3 storage, connection pooler, rate limiting.
5. **WhatsApp Cloud API go-live** — when the Meta WABA is ready (code is done).
