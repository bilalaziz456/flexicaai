# Klenic — Task Tracker (Completed + Remaining)

> Updated 2026-07-21. The CLAUDE.md §11 MVP (steps 1–12) is complete. This tracks
> post-MVP work: ✅ = shipped, [ ] = remaining. Roughly ordered by product value.
>
> **v1 scope decision (2026-07-21):** the **Clinic-operations** v1 work — **prescription
> history**, **expenses → central Trash**, **no-show rate** (§D) — is ✅ shipped.
>
> **Infra decision (2026-07-21):** build all **non-deploy-gated** platform/infra now
> (§B: in-app + email-code notifications, Postgres RLS, rate limiting, hash hardening).
> Everything needing a chosen host or external credentials — **file storage swap,
> connection pooler, AI API keys (Claude/Whisper), email provider, WhatsApp Cloud
> go-live** — is deferred to the **§Z Final v1 phase** and activated together at deploy.

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

### v1 status (checked 2026-07-21)

**The clinic-facing product v1 is feature-complete.** Excluding **§Z** (the deploy /
external-activation phase), what's left is NOT clinic-app features:

- **Clinic app v1 — ✅ done.** Every §B/§C/§D v1 item shipped. Only **§Z** (pick a host,
  then activate storage / pooler / AI keys / email SMTP / WhatsApp Cloud) remains to
  actually go live.
- **Commercial / go-to-market (§A)** — payment gateways, SaaS billing, marketing site.
  NOT required for a clinic to run the app (manual billing + manual onboarding work);
  this is a **v1.5 / separate commercial track** — decide v1-vs-v2 per item.
- **Hygiene (Cleanup)** — small dead-code + orphaned-test-user cleanup; do before release.
- **Explicitly v2** — operational analytics, inventory/payroll/attendance, realtime
  notifications, derma/hair modules.

### A. Payments gateway & SaaS (money movement is built; integrations are not)
- [ ] **Online payment gateways** — `/core/integrations/payments` still empty; no
      JazzCash / Easypaisa / Raast / Stripe. (Manual payment recording, receipts,
      partial payments + outstanding are DONE — see Finance & billing above.)
- [ ] **SaaS billing & usage (super admin)** — per-clinic billing, plans, usage metering.
- [ ] **Marketing site** — `/(marketing)` (landing, pricing, SSG); only `(auth)` exists.
      **→ v3 / commercial** (decided 2026-07-21) — the public storefront (lead-gen, since
      signup is admin-provisioned); not needed for the clinic app, can even be a
      standalone/no-code site.

### B. Platform / infrastructure — **building now**

Everything here can be built WITHOUT choosing a deploy target or wiring an external
provider. Provider credentials / go-live (email, storage, AI, WhatsApp) are deferred
to **§Z Final v1 phase**.

- [x] **In-app notifications** — ✅ per-user bell (`notifications` table 0050,
      `core/notifications/in-app.ts`, `NotificationBell` in the shell). Self-scoped inbox
      (no new ACL resource); targeting via existing permissions
      (`notifyUsersWithPermission`). 60s-poll + on-focus refresh. 5 triggers wired
      (discount approval needed/decided, WhatsApp inbound, patient self-book/reschedule,
      doctor payout). See docs/notifications-plan.md. _Remaining (optional):_ prune cron
      for old read rows; super-admin/platform bell + realtime are v2.
- [x] **Email notifications (code)** — ✅ SMTP channel (`core/notifications/email.ts`,
      nodemailer, config-gated → no-op until §Z creds) + branded template; self-service
      **password reset** (`password_reset_tokens` 0051, `core/auth/password-reset.ts` —
      hashed single-use tokens, session-revoke, no enumeration) with `/forgot-password`
      + `/reset-password` pages, rate-limited. See docs/email-plan.md. _Remaining:_
      live SMTP creds + send test = §Z. (Staff-invite email dropped — not needed.)
- [x] **Tenant-scope guard (RLS substitute)** — ✅ `core/db/tenant-guard.ts`: a Drizzle
      logger flags any query touching a `clinic_id` table without a clinic_id scope;
      `unscoped("reason", …)` opt-out for intentional cross-tenant reads; WARN by default,
      `TENANT_GUARD_STRICT=1` throws (tests/CI). Decided over native RLS 2026-07-21 — same
      failure mode (a dropped filter), no per-request DB-session/connection-pinning cost.
      Wrapping pass DONE — all cross-tenant system paths (admin logs, the 3 crons, both
      WhatsApp inbound webhooks) wrapped in `unscoped()`; strict mode is clean end-to-end
      (`TENANT_GUARD_STRICT=1` → unit + e2e 61/61). CI can now run strict.
- [ ] ~~**Postgres RLS**~~ — deferred to §Z; revisit only if a direct-DB/BI connection is
      added or a compliance checkbox requires native RLS. The guard above covers the
      forgotten-`byClinic()` risk for the trusted single-tier app.
- [x] **Rate limiting** — ✅ login brute-force gate (`core/security/rate-limit.ts`):
      per-username 5/15min (reset on success) + per-IP 50/15min, in-memory fixed-window;
      wired into `signIn`. Swap the `Limiter` for a shared store at §Z (multi-instance).
      _Remaining:_ optional generic API/route throttle.
- [ ] **Load / scaling hardening (code parts)** — bcryptjs already uses the async
      (chunked) API; the native-hash swap + pool `max` / connection-pooler are
      platform-specific → §Z.

_Deferred to §Z (deploy-gated):_ **File storage** — `core/integrations/storage` is
local FS; the S3-compatible (or server-disk) swap depends on the chosen host
(S3 / Linux / Windows), so it lands in the final phase.

### C. Dental clinical depth — ✅ shipped (dental clinical arc, migrations 0044–0049)
- [x] **Tooth chart / odontogram** + `dental_records` / `dental_charts` tables linked to
      `visits` (module-owned schema; core untouched); read-only chart + printable chart.
- [x] **Treatment plans** — `treatment-templates.ts` + `treatmentTemplates` in the module
      registry; multi-visit priced/tooth-tagged plans + printable estimate; `plans` ACL.
- [x] **Clinical imaging / X-ray / photo attachments** (+ consent-tracked photo use);
      `attachments` ACL.
- [x] **Lab-work tracking** (crowns/dentures) + "your crown is ready" WhatsApp; `lab` ACL.

### D. Clinic-operations

**→ v1 — ✅ shipped:**
- [x] **Standalone prescription history** — per-patient "Prescriptions" card on the
      patient detail (approved `visits.note.prescriptions`, projected to drug lines
      only); reprint via the existing `/api/prescriptions/[visitId]` PDF;
      `prescriptions:view` ACL.
- [x] **No-show rate** — `no_show / (completed + no_show)` over a period, per-doctor
      breakdown (`/clinic/no-shows`, `appointments:view`, not finance-gated) + a
      dashboard stat + an Overview card (`core/appointments/no-shows.ts`).
- [x] **Expenses → central Trash** — `expense` entity wired into `core/trash`
      (list + restore + purge) and both Trash UIs; `trash` ACL.

Also: moved `/clinic/overview` → `/clinic/reports/overview` (consistent with
`/clinic/reports/daybook`).

**→ v2 (defer):**
- [ ] **Reporting beyond finance (rest)** — utilization, doctor productivity,
      recall-effectiveness. (Sales / Discounts / Shares / P&L / Receivables / Day book /
      Overview are DONE.)
- [ ] **Inventory / payroll / attendance**. (Expenses is DONE.)

- [x] **Recurring-expense automation** (cron) — `core/expenses/recurring.ts` +
      `GET /api/cron/expenses` (migration 0043). ✅ shipped.

### Z. Final v1 phase — deploy & external activation (code is/► will be done first)

Everything whose CODE is written but that needs a **chosen host** or **external
credentials** to actually go live. Deliberately last: decided 2026-07-21 to build all
non-deploy infra first, then activate these together at deploy.

- [ ] **Deploy target decision** — S3 vs Linux vs Windows server (drives storage + pooler).
- [ ] **File storage swap** — `core/integrations/storage` local FS → S3-compatible (or
      the chosen server's disk). Code is abstracted behind the storage module.
- [ ] **Connection pooler + pool sizing** — depends on the host (serverless vs a box).
- [ ] **External AI APIs go-live** — set `ANTHROPIC_API_KEY` (Claude scribe/chat) +
      `OPENAI_API_KEY` (Whisper); live transcribe→note test. Code is done (the scribe
      gracefully no-ops without keys).
- [ ] **Email provider go-live** — plug SMTP/provider credentials into the email channel
      built in §B; live password-reset send test.
- [ ] **WhatsApp Cloud API go-live** (external, code is done):
  - [ ] Meta Business account + verification + WABA + system-user token.
  - [ ] Set `WHATSAPP_PROVIDER=cloud` + token / WABA id / verify token / app secret;
        point Meta's webhook at `/api/whatsapp/cloud`.
  - [ ] Create + get the 7 Utility templates approved (`docs/whatsapp-cloud-plan.md` §C).
  - [ ] Decide the "always-present variable" handling (docs §D).
  - [ ] Provision a pilot clinic's number → live send/receive test → roll out.
- [ ] **Any other third-party API** (payment gateway keys, etc.) — activate here.

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
1. ~~**Dental clinical model** — tooth chart + `dental_records` + treatment plans.~~ ✅ shipped.
2. ~~**Clinic-operations v1** — prescription history, no-show rate, expenses-Trash.~~ ✅ shipped.
3. **Platform / infrastructure (§B)** — in-app + email(code) notifications, Postgres RLS,
   rate limiting, hash hardening. ← **building now (decided 2026-07-21).**
4. **Online payment gateways** — JazzCash / Easypaisa / Raast / Stripe (code now; keys at §Z).
5. **§Z Final v1 phase** — pick the host, then activate storage, pooler, AI keys, email
   provider, and WhatsApp Cloud go-live together.
