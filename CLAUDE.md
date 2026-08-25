@AGENTS.md

# CLAUDE.md — FlexicaAI

This file guides Claude Code when developing this application. Read it fully before writing any code. Follow these conventions strictly.

---

## 1. What we are building

FlexicaAI is a modular SaaS platform for dental clinics in Pakistan and the GCC. The first specialty is **dental**, but the architecture MUST support adding **derma** and **hair transplant** modules later without rewriting the core.

**The golden rule of this codebase: 70-80% of the code is shared CORE. 20-30% is specialty-specific MODULES. Never mix the two.**

### Current scope (build now)
- Core platform (shared infrastructure)
- Dental module only

### Future scope (architect for, do NOT build yet)
- Derma module
- Hair transplant module

When writing any feature, always ask: "Would a dentist, dermatologist, and hair surgeon all use this identically?" If yes → it goes in `/core`. If no → it goes in `/modules/{specialty}`.

---

## 2. Tech stack (do not deviate)

- **Framework:** Next.js 14+ (App Router, not Pages Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS + shadcn/ui components
- **Database:** PostgreSQL (self-hosted / local; no Supabase)
- **ORM / query layer:** Drizzle ORM over `pg` (node-postgres), single pool.
  Default to Drizzle; drop to raw SQL via `db.execute(sql\`…\`)` on the SAME pool
  for heavy analytics / hand-tuned queries. See `src/core/db/index.ts` for the policy.
- **Auth:** Custom session auth — `users` table (bcrypt hashes) + `sessions` table +
  HTTP-only cookie holding an opaque token (SHA-256 hash stored). No third-party auth.
- **File storage:** local filesystem — a real, persistent disk on the server
  (audio, PDFs, photos, attachments, logos). All access goes through
  `core/integrations/storage`, so an S3-compatible store can be swapped in later
  by changing that one module. (Was Supabase Storage.)
- **AI reasoning:** Anthropic Claude API (scribe, chat)
- **Voice transcription:** OpenAI Whisper API
- **WhatsApp:** AiSensy (WhatsApp Business API provider)
- **Background jobs:** system **cron / systemd timers** on the server calling the
  `/api/cron/*` endpoints with the `CRON_SECRET`; add BullMQ + Redis only when needed
- **Hosting:** a **self-managed Linux server** (single node), Node running
  `next start` behind **nginx** as the TLS-terminating reverse proxy
- **PDF generation:** react-pdf or pdfkit

Do not introduce new libraries or frameworks without a clear reason. Prefer boring, proven choices.

> **Stack note (2026-07-06):** The DB/Auth/Storage stack was changed from Supabase to
> **local PostgreSQL + Drizzle + custom session auth** at the owner's direction. Any older
> references to Supabase elsewhere in this file are superseded by this section.

> **Hosting note (2026-08-21):** Hosting was changed from **Vercel** to a
> **self-managed Linux server** at the owner's direction. This is not a cosmetic
> swap — it is what makes several existing design choices CORRECT rather than
> merely tolerated, and it moves three constraints. See §2a. Any older reference to
> Vercel elsewhere in this file or in `/docs` is superseded.

---

## 2a. What the Linux server means (read before touching infra)

The app was architected **single-node-first** on purpose, and a persistent Linux box
is the deployment that assumption was written for. Two things that would be
liabilities on a serverless host are therefore *correct* here: **local-filesystem
storage** (a real disk persists, so clinical attachments are safe) and the
**in-memory rate limiter** (one Node process, so brute-force protection works).

**Three constraints this moves — do not lose these:**

1. **Nothing schedules the jobs unless you configure it.** There is no platform
   cron; `vercel.json` is inert. Run `sudo ./deploy/install-cron.sh all` (eight jobs;
   `core` installs only the six needing no API). Miss it and recalls, reminders and
   the nightly sales **reconciliation** never fire — silently, because a job that is
   never invoked raises no error. Verify afterwards with `./deploy/install-cron.sh
   check`. **Currently held** until launch (delta D-19), which is safe only while
   there are no live clinics.
2. **nginx's `proxy_read_timeout` is the request ceiling** (default **60s**), and
   `maxDuration` is a platform hint that does nothing here. The scribe no longer needs
   it raised — it returns 202 and the AI runs in a background job (ADR-020) — but
   **`client_max_body_size 25m` on `/api/ai/scribe` is still required**, or a normal
   dictation is rejected at the proxy before the app sees it. Any future route that
   does hold a connection open still has to reckon with the 60s default.
3. **Single node is an assumption with teeth.** A second instance or PM2 *cluster*
   mode breaks local storage and the limiter **quietly**. Going multi-instance means
   doing the S3 and Redis swaps FIRST.

**Also ours to own:** TLS/HSTS at nginx · a process manager (systemd, or PM2 in
*fork* mode) · **backups of Postgres and `STORAGE_DIR` together** (one dataset —
restoring one without the other leaves rows pointing at missing attachments) · disk
monitoring · the server timezone that availability and reminders read from.

Full detail, and the triggers that force each change: `.claude/architecture.md` §7.

---

## 3. Folder structure (enforce strictly)

> **Architecture source of truth: `.claude/architecture.md`** — layer contracts,
> dependency rules, the decision log (ADRs), the deltas between code and intent, and
> the scaling triggers. Read it before any structural work, and **if your change
> alters a layer boundary, a dependency rule, the module contract, the deployment
> shape, or an architectural decision, update it in the SAME commit** (its §0 defines
> when). Ordinary features and fixes need no update.

@.claude/architecture.md

```
/src
  /app                          # Next.js App Router routes
    /(marketing)                # Public pages (SSG) — landing, pricing
    /(auth)                     # Login, signup
    /admin                      # Super Admin panel (you, the company)
    /clinic                     # Clinic Admin panel (clinic owner)
    /doctor                     # Doctor interface (voice scribe)
    /reception                  # Receptionist interface
    /api                        # API routes (backend)
      /ai
      /whatsapp
      /recall

  /core                         # SHARED PLATFORM — used by all specialties
    /auth                       # Session, roles, permissions
    /db                         # Database client, schema types, queries
    /ai
      /scribe-engine            # Generic voice→note engine (calls Whisper + Claude)
      /chat-engine              # Generic WhatsApp AI agent base
      /prompt-runner            # Generic prompt execution + error handling
    /integrations
      /whatsapp                 # WhatsApp send/receive (specialty-agnostic)
      /storage                  # File upload/download
      /payments                 # JazzCash, Easypaisa, Raast, Stripe
    /recall                     # Recall scheduler (runs rules, sends reminders)
    /notifications              # Email, WhatsApp, in-app alerts
    /ui                         # Shared UI components (buttons, tables, cards)
    /lib                        # Shared utilities, constants, helpers
    /types                      # Shared TypeScript types

  /modules                      # SPECIALTY-SPECIFIC — one folder per specialty
    /dental                     # BUILD THIS NOW
      /prompts                  # Dental-specific AI prompts
      /components               # Tooth chart, dental-specific UI
      /recall-rules.ts          # 6-month cleaning, etc.
      /drug-formulary.ts        # Dental medications (Pakistan brands)
      /treatment-templates.ts   # Dental treatment plan templates
      /config.ts                # Module metadata (name, features, pricing)
    /derma                      # DO NOT BUILD YET — folder may not exist
    /hair-transplant            # DO NOT BUILD YET — folder may not exist

  /config
    modules.ts                  # Registry of available modules
```

### Rules for this structure
- Nothing in `/core` may import from `/modules`. Core must never know which specialties exist.
- Modules may import from `/core`. That's the whole point — modules build on core.
- Each module is self-contained in its folder.
- If you're tempted to put specialty logic in core, stop. Make it a module.

---

## 4. The module system (the heart of the architecture)

### Every clinic has enabled modules

The `clinics` table has a `modules_enabled` column: a string array like `["dental"]` or `["derma", "hair_transplant"]`.

### Core must be module-aware, module-agnostic

Core code checks *which* modules are enabled but never hardcodes *what* they are:

```typescript
// GOOD — core checks the list, doesn't know specifics
const enabledModules = clinic.modules_enabled;
const prompts = enabledModules.map(m => loadModulePrompt(m));

// BAD — core hardcodes a specialty
if (clinic.specialty === "dental") { /* ... */ }  // NEVER do this in core
```

### Module registry pattern

`/config/modules.ts` is the single registry. Each module registers itself with a consistent interface:

```typescript
export interface ModuleDefinition {
  id: string;                    // "dental"
  name: string;                  // "Dental"
  scribePrompt: string;          // specialty AI prompt
  recallRules: RecallRule[];     // recall intervals
  drugFormulary: Drug[];         // specialty medications
  components: ModuleComponents;  // specialty UI components
  navItems: NavItem[];           // sidebar menu items
}
```

When you add derma later, you create `/modules/derma/config.ts` following the same interface and register it. No core changes needed. This is the test of good modular design: adding a module touches only `/modules` and the registry, never core logic.

### Loading modules at runtime

```typescript
function getClinicWorkspace(clinic: Clinic) {
  const modules = clinic.modules_enabled.map(id => loadModule(id));
  return {
    navItems: modules.flatMap(m => m.navItems),
    prompts: modules.map(m => m.scribePrompt),
    // ... only what the clinic's modules provide
  };
}
```

---

## 5. Database schema principles

Design every table to support multiple specialties from day one. The
**non-negotiable guardrails** (keep these in mind on every query):

- **Core tables are specialty-agnostic.** The `module` column is a free-text tag,
  never an enum — adding derma/hair must need no schema change.
- **Specialty data goes in related tables, not core.** Dental tooth-chart state
  lives in a `dental_records` table linked to `visits`, never as columns on core
  tables. When derma is added, `derma_records` is a new table; core tables never
  change.
- **Multi-tenancy:** every tenant table has `clinic_id`, and **every query filters
  by `clinic_id`** via the `byClinic()` helper (`src/core/db/tenant.ts`). The
  browser never queries the DB; all access is via Server Actions / Route Handlers.

**`src/core/db/schema/` is the source of truth** (split by domain behind a barrel —
import from `@/core/db/schema`). The full table-by-table
reference (columns, FK behaviours, enums, indexes) lives in the imported file
below — read it before touching the schema:

@.claude/database.md

---

## 6. The four user panels

Build these as separate route groups. Each respects the clinic's enabled modules.

1. **Super Admin** (`/admin`) — for the company (you). Create clinics, toggle modules, view billing, monitor usage. Only internal staff access this.
2. **Clinic Admin** (`/clinic`) — for the clinic owner. Manage staff, settings, view analytics, billing.
3. **Doctor** (`/doctor`) — voice scribe, patient records, prescriptions. Mobile-friendly (doctors use tablets).
4. **Receptionist** (`/reception`) — appointments, WhatsApp queue, payments.

Patients are NOT a panel — they interact via WhatsApp only (for now).

UI must show/hide features based on `modules_enabled`. A dental-only clinic never sees derma UI.

---

## 7. Rendering strategy (Next.js)

- **Marketing pages** (`/(marketing)`) → static (SSG). SEO matters.
- **Logged-in panels** → server components by default (SSR). Fresh data, no SEO needed.
- **Interactive features** (voice recorder, live WhatsApp queue) → client components (`"use client"`).

Default to server components. Only use client components for genuine interactivity.

This split is now load-bearing for security, not just speed: **a CSP nonce can only be
applied to a server-rendered response**, so the panels get a strict nonce-based
`script-src` and the prerendered public pages cannot (ADR-026). Changing what is static
here changes the CSP — check `src/proxy.ts` in the same breath.

---

## 8. The AI scribe engine (core) — the most important feature

Flow: doctor records (MediaRecorder) → `/api/ai/scribe` → Whisper transcribes →
Claude structures it using the ENABLED MODULE's prompt → saved as a **draft** visit →
doctor reviews, edits, approves. Full flow map, timeout budget and failure taxonomy:
`@.claude/ai-scribe.md`.

### Critical AI rules (non-negotiable)
- The scribe engine in `/core` is generic. It receives a prompt; it does not know dental from derma.
- The dental prompt lives in `/modules/dental/prompts`.
- **Every AI output is a DRAFT.** A clinician must review and approve before it becomes the record. Never auto-finalize medical notes or prescriptions. Who may approve is the `clinical:create` PERMISSION, not the `doctor` role — in this market the clinic owner is usually the practising dentist, so the scribe actions gate on `can()` and admit any workspace role holding that grant. A draft still belongs to whoever dictated it: only its author can reopen or approve it — with ONE opt-in exception, the `handover` grant, and only for a draft whose author can no longer log in (ADR-022).
- Drug names must be validated against the module's drug formulary before showing.
- Always include confidence handling: if transcription is unclear, flag it for the doctor rather than guessing.
- Log every AI interaction (input, output, doctor's edits) for the accuracy flywheel.
- **Never log a transcript or note** to console or an error tracker (§10).

### Claude API usage
- Use `claude-sonnet-4-6` for scribe (quality matters). Pinned in one place: `core/ai/prompt-runner`.
- Use a cheaper model (Haiku) for simple WhatsApp auto-replies.
- Prompt the model to return ONLY JSON for structured notes; parse safely; handle malformed responses.

Read the imported contract before touching anything under `core/ai`.

@.claude/ai-scribe.md

---

## 9. Coding conventions

- TypeScript strict mode. No `any` unless truly unavoidable (comment why).
- Use server actions or API routes for mutations; never expose secrets to the client.
- All secrets (API keys) in environment variables, never committed.
- Validate all inputs (use zod) — including anything written into a `jsonb` column.
- Every database query filters by `clinic_id`; every read of a soft-deletable table
  filters `deleted_at IS NULL`.
- Keep functions small and single-purpose.
- Name things clearly: `generateDentalNote` not `genNote`.
- Prefer composition over inheritance.
- Write a brief comment above any non-obvious logic explaining WHY (not what).
- Handle errors explicitly — especially around AI calls, WhatsApp, and payments (these fail often).
- **A swallowed failure is `report()`ed, never silent** (`core/observability`).

---

## 10. Security & compliance (healthcare data)

- Patient data is sensitive. Encrypt in transit (HTTPS); enable Postgres encryption
  at rest on the deployment (disk/volume encryption or `pgcrypto` for specific fields).
- Enforce tenant isolation in the server query layer (filter every query by `clinic_id`);
  add native Postgres RLS later as defense-in-depth.
- Role-based access: a receptionist should not see clinical notes unless the clinic allows it.
- Audit log every action that touches patient data.
- Never log patient PII to console or error trackers in plain text. Report **ids, not names**.
- Consent: track patient consent for data use and (later) photo use.
- Data residency: architect so Pakistan data can stay in a Pakistan/nearby region and GCC data in-region later.
- Public surfaces (webhooks, cron endpoints, signed links) verify their secret in
  **constant time** and **fail closed in production**.

Working detail for §9 and §10 — server/client boundary, action shapes, the `report()`
contract, tenant guard, PII redaction, audit snapshots, consent, public surfaces:

@.claude/conventions.md

---

## 11. What to build first (strict order)

Do not jump ahead. Build in this sequence:

1. Project setup: Next.js + PostgreSQL/Drizzle + Tailwind + shadcn/ui
2. Auth: login/signup, roles, session
3. Core DB schema: clinics (with `modules_enabled`), users, patients, appointments, visits, recalls
4. Module registry + dental module skeleton (`/modules/dental/config.ts`)
5. Super Admin panel: create a clinic, enable dental module
6. Clinic Admin panel: dashboard, add staff, add patients
7. Doctor panel: **voice scribe** (record → transcribe → Claude → structured dental note → approve → save)
8. Prescription generator (dental formulary, PDF, WhatsApp delivery)
9. WhatsApp integration (send/receive)
10. Recall engine (capture next-visit date → schedule → send reminder → book)
11. Receptionist panel: appointments + WhatsApp queue
12. Owner dashboard: "Revenue Recovered" metric

Stop after this. That's the MVP. Do not build derma, hair, mobile apps, or advanced analytics until instructed.

### Post-MVP additions (built after the §11 MVP, at the owner's direction)

The §11 MVP is complete; the features below were added afterward on the owner's
instruction. They all still honour the core guardrails (core-vs-module, `clinic_id`
scoping, draft-then-approve, notifications best-effort). **Source of truth:**
`src/core/db/schema/` (schema) and `PROGRESS.md` (dated change log); new env vars
are in `.env.example`.

- **Owner "Revenue Recovered" dashboard** — an optional per-clinic feature the super
  admin toggles. Columns `clinics.avg_visit_value`, `clinics.features_enabled`
  (registry in `core/lib/features.ts`; specialty-agnostic).
- **Doctor scheduling** — per-weekday working hours + daily appointment cap +
  consultation fee. On `users`: `availability` (jsonb), `daily_appointment_limit`,
  `consultation_fee`. One validator — `core/appointments/availability.ts#checkDoctorSlot`
  — is enforced by both booking and reschedule.
- **Doctor leave / vacation** — `doctor_leaves` table. Setting leave cancels the
  doctor's appointments in the range and blocks new bookings; settable by receptionist
  and clinic admin.
- **Appointments beyond reception** — clinic admin can manage appointments
  (`/clinic/appointments`, `…/new`) and full staff records (`/clinic/staff/[id]`);
  the appointment actions accept receptionist OR clinic_admin.
- **WhatsApp appointment lifecycle** (`core/notifications/appointment.ts`, campaigns in
  env): booking confirmation, cancellation notice, day-before reminder (cron
  `/api/cron/reminders`, `appointments.reminder_sent_at`), and patient self-service
  over inbound replies — **reschedule** (`core/appointments/reschedule.ts`) and
  **new booking** (`core/appointments/booking.ts`), both parsing dates via
  `parse-when.ts` and validating via `checkDoctorSlot`. Wired in the inbound webhook.
- **Per-user ACL (permissions)** — two-tier: super admin → clinic capabilities, and
  clinic admin → per-user `resource:action` grants (`users.permissions`; catalog +
  role defaults in `core/auth/permissions.ts`). A `manager` role was added. Unified
  `/clinic` workspace: all clinic staff share it, nav + pages gate on permissions
  (`requireWorkspace`). Staff/settings management stays clinic-admin-only — but a
  clinic may now have **more than one `clinic_admin`** (2026-08-26): admins are peers
  and can create, edit, suspend and delete each other, because the alternative people
  reach for is a shared login, which destroys the audit trail §10 exists to keep. The
  one invariant that makes that safe: **a clinic can never be left with no active
  admin** (`core/users/clinic-staff.ts#assertNotLastAdmin`; the last one's suspend and
  delete controls are withheld in the UI and refused server-side).
- **Sales** — priced `procedures`, per-appointment `appointment_procedures` line
  items (+ per-line & appointment discounts), and a realised-revenue `sales` ledger
  → the `/clinic/sales` report + dashboard card. Gated by the `sales` feature.
  Bill math is centralised in `core/appointments/fee.ts`.
- **Soft delete + Trash** — NOTHING is hard-deleted. Every deletable table carries
  `deleted_at`/`deleted_by`/`delete_group`/`deleted_by_cascade` (`softDeleteColumns()`);
  every read filters `notDeleted()`; deletes UPDATE those columns and cascade-hide
  children under one group. `/clinic/trash` (within `clinics.trash_retention_days`,
  default 30) and `/admin/trash` (all clinics, no window) list + **Restore**
  (`core/trash`), gated by the `trash` permission. The ONLY physical delete is a
  super-admin legal **purge**. Search + type/actor/date/clinic filters on both.
- **Super-admin control plane** (`/admin`) — the COMPANY's panel (`docs/super-admin-plan.md`):
  clinic subscription **billing** (`clinic_payments`, advance/partial + overdue +
  follow-up), a two-tier **admin ACL** (`users.permissions` admin `resource:action`
  slugs; NULL = the `owner`), **team** management (suspend/deactivate + a `team`
  capability + password step-up on delete), account-manager **assignment**
  (`clinics.assigned_to`) with scoped visibility, **impersonation** (read-only "view
  as clinic"), **announcements**, 2FA/security, and per-clinic **capabilities**/features.
- **Owner Finance** — "how much are WE (FlexicaAI) earning?" (`docs/owner-finance-plan.md`),
  all **core**, each area under its own admin capability (`pnl` · `serving_cost` ·
  `expenses` · `sub_invoices`, independently grantable) + the `revenue:view` gate:
  **serving cost** (AI + WhatsApp, **metered** per Whisper-minute / Claude-token via
  `ai_usage`, flat estimate fallback; `platform_cost_rates`), a company **operating-
  expenses** ledger (`company_expenses`), the **P&L** (collected − serving cost − opex
  = net profit; cash-aware for refunds/credits), **subscription invoices** to clinics
  (`clinic_invoices`, company-global numbering), and a CSV export. `core/admin/cost.ts`
  / `pnl.ts` / `company-expenses.ts` / `clinic-invoices.ts`.
- **Owner Overview** (`/admin/overview`, the super-admin's landing page) — company at a
  glance: money KPIs (`getCompanyMetrics`), **churn risk** (a live clinic quiet ≥ N
  days — visits/appointments/WhatsApp/logins — threshold persisted in
  `company_settings`), per-clinic **activity/usage/margin**, and **usage/cost anomaly
  flags** (loss / high-cost / spike, tunable thresholds). `core/admin/health.ts`,
  `core/admin/company-settings.ts`.

Still NOT to build without instruction (§11/§12 unchanged): derma, hair, mobile apps,
advanced analytics.

---

## 12. Anti-patterns — do NOT do these

- Do NOT hardcode "dental" logic in `/core`. Core is specialty-agnostic.
- Do NOT build derma or hair modules now. Only architect for them.
- Do NOT over-abstract. Build dental concretely; extract patterns into core only when a second module actually needs them.
- Do NOT auto-finalize AI-generated medical content. Always approved by a clinician holding `clinical:create`, and only ever by the author of that draft — unless the author can no longer log in AND the approver holds `handover` (ADR-022; nothing else relaxes this).
- Do NOT put specialty columns on core tables. Use related specialty tables.
- Do NOT skip `clinic_id` filtering on any query.
- Do NOT hard-delete records. Everything soft-deletes to Trash (`softDeleteColumns()`);
  a delete UPDATEs `deleted_at` and every read must include `notDeleted()`. The only
  `db.delete()` on a soft-deletable table is the super-admin legal purge (`core/trash`).
- Do NOT add features outside the current MVP scope, even if they seem quick.
- Do NOT introduce new major dependencies without justification.
- Do NOT build a separate backend. Next.js API routes are the backend for now.

---

## 13. When adding a new module later (reference for the future)

To add derma (or hair) — this should touch ONLY `/modules` and the registry:
1. Create `/modules/derma/` with: `config.ts`, `prompts/`, `components/`, `recall-rules.ts`, `drug-formulary.ts`
2. Register it in `/config/modules.ts`
3. Enable it for a clinic via `modules_enabled`
4. Zero changes to `/core` should be required.

If adding a module requires changing core logic, the core was not properly abstracted — fix the abstraction, don't patch the module in.

---

## 14. Definition of done for any feature

- Works for a dental clinic end to end
- Respects `modules_enabled` (hidden/shown correctly)
- Filters by `clinic_id` everywhere
- AI outputs are draft-then-approved
- Errors handled gracefully — a swallowed failure is `report()`ed, never silent
- No secrets in client code, and no patient PII in logs or reports
- TypeScript compiles with no errors
- Core has no knowledge of specific specialties
- **If it changed the architecture, `.claude/architecture.md` was updated in the
  same commit** (its §0 defines "changed the architecture")

---

## 15. Quick reference — the mental test

Before writing any code, ask:
1. **Core or module?** Would all three specialties use this identically? → core. Else → module.
2. **Does it respect modules_enabled?** Will a dental-only clinic correctly not see other modules?
3. **Is patient data filtered by clinic_id?**
4. **Is AI output approved by its author, not auto-finalized?**
5. **Am I staying in MVP scope?**
6. **Which layer owns this?** A query belongs in `core/<domain>`, never in a page or
   action; anything two panels share belongs in `core/ui`. (`.claude/architecture.md` §2)

If all six pass, proceed. If not, rethink before coding.
`.claude/architecture.md` §8 is the longer version of this checklist.

---

## 16. When this file grows — how to split it

Keep this as a single file while it is under ~500 lines. Do NOT split prematurely — the right boundaries only become clear once the project grows. Split when this file crosses ~500 lines, or when a single section (e.g. the full database schema, or a module spec) becomes large enough to stand on its own.

### The split principle
Keep the **always-true guardrails** in this root file. Move **reference detail** into imported files. Claude Code loads the root on every session, so the non-negotiable rules must live here; bulky detail can be imported as needed.

- **Stays in root CLAUDE.md (always loaded, keep short):** the golden rule (70-80% core / 20-30% modules), tech stack, build order, anti-patterns, and the section 15 mental test.
- **Moves into imported files (loaded as needed):** detailed database schema, full architecture spec, and each module's specification.

### Target structure when splitting
```
/CLAUDE.md                    # short: golden rules + imports + build order
/.claude/
  database.md                 # schema, multi-tenancy, RLS (section 5) — DONE (imported by §5)
  architecture.md             # layers, dependency rules, DECISION LOG, deltas — DONE (imported by §3)
  ai-scribe.md                # scribe engine rules (section 8) — DONE (imported by §8)
  conventions.md              # coding style + security (sections 9-10) — DONE (imported by §9/§10)
  /modules/
    dental.md                 # dental module spec (build now)
    derma.md                  # later
    hair.md                   # later
```
**Status:** all four are split out and imported from the section each expands —
`architecture.md` (§3), `database.md` (§5), `ai-scribe.md` (§8), `conventions.md`
(§9/§10). Root keeps the non-negotiables inline so they are impossible to miss; the
imported file carries the working detail. The `/modules/*.md` specs are still to come.

`architecture.md` went further than a §3/§4 extraction: it is the **living**
architecture record — layer contracts, dependency rules, a numbered decision log
(ADRs, each dated, never deleted, only superseded), the deltas between the code and
the intended design, and the triggers that would force a change. It is the one file
to update when an architectural decision is made or reversed; its §0 states exactly
when that is required.

### How to reference imported files from root
Use Claude Code's import syntax (`@` + path, on its own line) at the point in this
file where the detail belongs, so it is pulled in automatically. Live imports today —
each sits inside the section it expands, not in a list here:

- `@.claude/architecture.md` → imported by §3
- `@.claude/database.md` → imported by §5
- `@.claude/ai-scribe.md` → imported by §8
- `@.claude/conventions.md` → imported by §9/§10

Do not add an import line for a file that does not exist yet.

### Rule when splitting
Moving content into a new file must not change its meaning. After splitting, verify the root still contains every non-negotiable guardrail, and that no rule was lost in a file Claude Code doesn't load. Split content, never dilute it.
