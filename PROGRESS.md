# PROGRESS.md — Klenic Implementation Tracker

> This file tracks what has been implemented and what remains. It is updated after
> every meaningful change. The build order follows CLAUDE.md §11. Do not jump ahead.
>
> **Legend:** ✅ done · 🔨 in progress · ⬜ not started · ⚠️ blocked/needs attention

_Last updated: 2026-07-06_

---

## Product decisions

- **No public signup — accounts are invite/admin-provisioned only** (decided 2026-07-06,
  supersedes an earlier trial-signup idea). There is no `/signup` page.
  - **Super Admin** (seeded directly) creates **clinics + each clinic's Clinic Admin**,
    and selects that clinic's specialties → `clinics.modules_enabled` (Step 5).
  - **Clinic Admin** creates their own staff: doctors, receptionists (Step 6).
  - **No account = no login.** Everyone provisioned this way uses the single `/login`.
  - The **specialty checkboxes** (Dental now; Derma/Hair "coming soon") therefore live on
    the Super Admin "create clinic" screen (Step 5), rendered from the module registry so
    new modules appear with zero UI changes.
- **Login = single shared page** for all roles; the proxy routes each role to its panel.
- **Stack change: Supabase → local PostgreSQL + Drizzle + custom auth** (decided 2026-07-06,
  supersedes CLAUDE.md's original Supabase stack; §2/§5/§10 updated). Owner wants data on
  own Postgres + fastest local queries. Implications:
  - DB access is 100% server-side (no browser DB client). Multi-tenancy enforced by
    filtering every query by `clinic_id` in the query layer (Postgres RLS later, optional).
  - Auth is home-grown: `users` (bcrypt) + `sessions` (opaque cookie token, SHA-256 in DB).
  - **Drizzle vs raw SQL policy:** default Drizzle; raw SQL via `db.execute(sql\`…\`)` on the
    same pool for heavy analytics / hand-tuned queries. Full policy in `src/core/db/index.ts`.
  - File storage → local filesystem for now (audio/PDF/photos), S3-compatible later.

---

## Environment

- Node: v24.18.0 ✅
- npm: 11.16.0 ✅
- git: **2.55.0** ✅ (repo initialized; commit identity set locally as "Bilal Aziz" &lt;bilalaziz456@gmail.com&gt;)
- Next.js: **16.2.10** (spec said "14+"; scaffold gave latest — App Router, satisfies "14+")
- React: 19.2.4 · Tailwind: **v4** · TypeScript: strict ✅
- **PostgreSQL 17** ✅ (local service `postgresql-x64-17` running) · **Drizzle ORM** + `pg`
  · **bcryptjs** · drizzle-kit / tsx / dotenv (dev)
- Note: an `AGENTS.md` (added by create-next-app) warns Next 16 has API changes vs
  older docs — check `node_modules/next/dist/docs/` when unsure. Imported from CLAUDE.md.

---

## Build order (CLAUDE.md §11)

### 1. Project setup ✅  _(reworked to local Postgres 2026-07-06)_
Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · shadcn/ui · **Drizzle + local Postgres**
- [x] Next.js app scaffolded (App Router, TS strict)
- [x] Tailwind configured (v4)
- [x] shadcn/ui initialized — output realigned to `/core/ui` + `/core/lib` per §3
- [x] Folder structure created per CLAUDE.md §3 (`/core`, `/modules`, `/config`)
- [x] DB layer wired: `core/db/index.ts` (single `pg` pool + Drizzle + raw escape hatch), `core/db/schema.ts`
- [x] Zod-validated env (`core/lib/env.ts`): server-only `DATABASE_URL` (no public vars now)
- [x] `.env.example` + `.env.local` updated to `DATABASE_URL` + seed vars
- [x] `drizzle.config.ts` + npm scripts (`db:generate/migrate/push/studio/seed`)
- [x] Typecheck clean + production build passes
- **Left for you:** set your Postgres password in `.env.local` `DATABASE_URL`, create the `klenic`
  database, then `npm run db:migrate` (see "How to run the DB" below).

### 2. Auth ✅  _(reworked to custom session auth 2026-07-06)_
- [x] Username/password login (`(auth)/login` + `signIn`/`signOut` in `core/auth/actions.ts`); no public signup
- [x] Roles: super_admin, clinic_admin, doctor, receptionist (`core/types/auth.ts` + `user_role` pg enum)
- [x] Custom sessions: `core/auth/session.ts` (opaque cookie token, SHA-256 hash in `sessions`), `password.ts` (bcrypt)
- [x] Server guards `requireUser` / `requireRole` (`core/auth/user.ts`) — the REAL auth gate; `signOut` + button
- [x] Edge-safe proxy (`src/proxy.ts`): coarse cookie-presence check only (no DB in Edge); role enforced in pages
- [x] Placeholder panel pages at `/admin`, `/clinic`, `/doctor`, `/reception` (role-gated)
- [x] Seed script `scripts/seed.ts` (`npm run db:seed`) creates the first super_admin
- [x] Typecheck + build green
- **Left for you:** after migrating, `npm run db:seed` to create your super admin, then log in.

### 3. Core DB schema ✅
- [x] `clinics` (with `modules_enabled` text[])
- [x] `users` (role, clinic_id, bcrypt hash, is_active) + `sessions`
- [x] `patients` (clinic-scoped; phone/WhatsApp, DOB, data-consent flag)
- [x] `appointments` (`module` text tag, status enum, scheduled_at, doctor)
- [x] `visits` (`module` tag, `status` draft/approved enum, transcript, JSONB note, approved_by)
- [x] `recalls` (`module` tag, due_at, status enum, source_visit link) — recall engine reads these
- [x] `module` kept as free-text tag (NOT enum) so new specialties need no schema change
- [x] Indexes on every `clinic_id` + common lookups (name/phone/date/status)
- [x] Tenant-scoping helper `byClinic()` (`core/db/tenant.ts`) — the multi-tenancy boundary
- [x] Migrations `0000` + `0001` applied; production build green
- **Note:** specialty clinical data (e.g. dental tooth-chart rows) will live in module tables
  linked to `visits`, never as columns on these core tables (CLAUDE.md §5).

### 4. Module registry + dental skeleton ✅
- [x] `ModuleDefinition` contract + specialty-catalog types (`core/types/module.ts`)
- [x] Dental module: `config.ts`, `prompts/scribe.ts`, `recall-rules.ts`, `drug-formulary.ts` (Pakistan brands)
- [x] `/config/modules.ts` registry: `MODULES`, helpers (`getModule`, `loadModules`, `getClinicWorkspace`)
- [x] `SPECIALTY_CATALOG` for Step 5 checkboxes: Dental=available, Derma/Hair=coming_soon (architected, not built)
- [x] Verified golden rule: `/core` imports from neither `/modules` nor `/config` (grep-clean)
- [x] Typecheck + build green
- **Adding a specialty later:** implement `/modules/<id>/config.ts`, register in `/config/modules.ts`,
  flip catalog entry to "available" — zero `/core` changes.

### 5. Super Admin panel (`/admin`) ✅ (billing deferred)
- [x] `/admin` layout guards super_admin; header + sign out
- [x] Clinics list (`/admin`) with specialty badges
- [x] Create clinic + **specialty checkboxes** (from `SPECIALTY_CATALOG`) + its Clinic Admin,
      in one transaction (`/admin/clinics/new`) — no service-role client needed (local Postgres)
- [x] Clinic detail (`/admin/clinics/[id]`): toggle modules + staff list (uses `byClinic()`)
- [x] Reusable `SpecialtyCheckboxes` (dental selectable; derma/hair disabled "coming soon")
- [x] Verified: `/admin` + `/admin/clinics/new` render 200 with a real super_admin session
- [x] **Force password change on first login** — `must_change_password` col (migration 0002),
      `/change-password` flow, enforced in `requireRole`; created clinic admins start with the flag.
      Verified: flag on → `/admin` 307 → `/change-password` 200.
- [x] **Edit a staff member's name + username** (unique-checked) from the clinic detail page
- [x] **Reset a staff password** — issues a temp password + sets the flag + revokes their sessions
- [x] **Rename clinic**; **suspend/reactivate** account (`is_active`, revokes sessions on suspend);
      **delete clinic** (danger zone, confirm by typing the name; cascades all its data)
- [ ] View billing / usage (deferred — not MVP-critical)
- [x] **Search** clinics by name on `/admin` (URL-driven `?q=`, debounced, case-insensitive)
- **Still deferred (revisit later):** billing & usage · audit log of admin actions (§10) ·
  pagination on clinics · clinic-level suspend. Not premature to skip now.

### 6. Clinic Admin panel (`/clinic`) ✅
- [x] Layout guards `clinic_admin` (via `requireClinicAdmin`, guarantees non-null clinicId); shows clinic name; nav
- [x] Dashboard: staff + patient counts (clinic-scoped, index-backed COUNTs)
- [x] Staff: add doctor/receptionist (temp password → must-change), list, suspend/reactivate, reset password
- [x] Patients: add (name, phone/WhatsApp, DOB, gender, address, consent), list, **search by name/phone**
- [x] All writes/reads clinic-scoped via `byClinic()`; staff mgmt also filters `clinic_id` so cross-clinic ids match 0 rows
- [x] Trigram (pg_trgm GIN) indexes on `patients.full_name` + `patients.phone` for fast ILIKE (migration 0006)
- [x] Verified: /clinic, /clinic/staff, /clinic/patients render 200 as clinic001; role isolation (clinic_admin → /admin 307)
- **Note:** clinic admin can only create `doctor`/`receptionist` — never admins.

### 7. Doctor panel — voice scribe (`/doctor`) ✅ _(needs API keys to run live)_
- [x] Voice recorder (client, browser MediaRecorder) — `scribe-workspace.tsx`
- [x] Audio → local filesystem storage (`core/integrations/storage`, clinic-namespaced; swap to S3 later)
- [x] `/api/ai/scribe`: Whisper (OpenAI, separate) → Claude (`claude-sonnet-4-6`) → structured note, using the CLINIC'S MODULE prompt (generic engine in `core/ai/scribe-engine` + `prompt-runner`; JSON via prompt + safe parse — Sonnet 4.6 has no `output_config.format`)
- [x] Draft → review/edit (generic `NoteEditor`, specialty-agnostic) → approve → save to `visits`
- [x] Flywheel: `visits.ai_draft` + `audio_key` (migration 0007) freeze the original AI output for edit-diffing
- [x] Drug validation against the module formulary (warns, doesn't block)

### 8. Prescription generator 🟨 _(PDF done; WhatsApp delivery deferred to Step 9)_
- [x] Dental drug formulary validation (drugs checked against the module formulary; scribe already warns at draft time)
- [x] PDF generation — generic CORE `core/lib/prescription-pdf.ts` (pdf-lib, built-in Helvetica; specialty-agnostic, renders {drug,dosage,duration}); `GET /api/prescriptions/[visitId]` serves it from the APPROVED visit note, clinic-scoped; doctor "Prescription" link on approved visits
- [ ] WhatsApp delivery → Step 9

> Lib note: used **pdf-lib** (not react-pdf/pdfkit from CLAUDE.md §2). Reason: both
> pdfkit and @react-pdf/renderer have font-file/asset bundling issues under Turbopack;
> pdf-lib embeds standard fonts with zero config and renders reliably in a Next route.

### 9. WhatsApp integration 🟨 _(infra done; needs AiSensy account + approved template to run live)_
- [x] CORE AiSensy client `core/integrations/whatsapp` (v2 Campaign/template API; specialty-agnostic; config-gated)
- [x] `whatsapp_messages` log table + enums (migration 0008) — records every send + inbound; source for the Step 11 queue
- [x] Notification channel `core/notifications/whatsapp` — records FIRST (queued), then sends, then updates status (nothing lost if unconfigured)
- [x] Inbound webhook `POST /api/whatsapp/webhook` (shared-token secured; logs incoming messages, best-effort patient match by phone; advances outbound status on delivery/read receipts)
- [x] Prescription delivery: signed public link (`core/lib/signed-link`, HMAC+expiry) → `GET /p/rx/[token]` serves the PDF with no session; doctor "WhatsApp" button (`sendPrescriptionToWhatsApp`) delivers it
- [x] Verified: webhook 401/200 + inbound row logged + status receipt advances; public link 200 PDF, tampered token 404. Typecheck green.
- **Config to go live:** `AISENSY_API_KEY` + an approved `AISENSY_RX_CAMPAIGN` template (with a document header), `WHATSAPP_WEBHOOK_TOKEN`, `LINK_SIGNING_SECRET`, `APP_URL`. Map the template body params in `sendPrescriptionToWhatsApp`.
- Deferred: per-clinic WhatsApp numbers (currently one platform-level AiSensy account); text/session messages (template-only for now).

### 10. Recall engine ✅ _(reminder send needs WhatsApp live; booking = Step 11)_
- [x] CORE engine `core/recall` — `scheduleRecall` (capture) + `processDueRecalls` (send due reminders via the WhatsApp channel), specialty-agnostic
- [x] Capture: approving a visit schedules a recall from the note's `nextVisit {reason, afterDays}` (`approveVisit`)
- [x] Cron endpoint `GET /api/cron/recalls` (CRON_SECRET-secured; Bearer or ?token) + `vercel.json` daily schedule (09:00)
- [x] Success → recall `sent`+sentAt; provider failure leaves it `pending` to retry (attempt still logged in `whatsapp_messages`); no phone → skipped
- [x] Clinic `Recalls` page + nav item (read-only list, responsive table/cards)
- [x] Verified: cron 401 without secret; authorized run picks only DUE recalls (`{processed:1,sent:0,skipped:1}`), leaves pending + logs a failed WhatsApp row when unconfigured; recalls page renders. Typecheck green.
- **To go live:** WhatsApp configured (Step 9) + an approved `AISENSY_RECALL_CAMPAIGN` template; set `CRON_SECRET` on Vercel.
- Booking (recall `sent` → `booked`) lands with the reception panel / inbound WhatsApp reply — Step 11.

### 11. Receptionist panel (`/reception`) 🟨 _(appointments + WhatsApp queue done; payments deferred)_
- [x] Appointments: list (`/reception`, newest first, patient+doctor, status badges), schedule (`/reception/new` — patient picker + doctor + datetime + reason), status actions (confirm/complete/cancel/no-show, icon-only on mobile); mobile `+` FAB; all clinic-scoped
- [x] WhatsApp queue (`/reception/whatsapp`): inbound + outbound messages for the clinic, newest first, patient-matched (reads the Step 9 `whatsapp_messages` log)
- [x] Reception nav = Appointments + WhatsApp (shared PanelShell); responsive table→cards throughout
- [x] Actions `createAppointment` / `setAppointmentStatus` / `searchClinicPatients` (tenant-scoped)
- [x] Verified with a seeded receptionist: all three pages 200, appointment + inbound message render, Confirm action + nav present. Typecheck green.
- [ ] Payments (JazzCash/Easypaisa/Raast/Stripe) — DEFERRED (needs provider accounts; like billing). Record-a-payment can be a light follow-up.
- Booking a recall → appointment from an inbound reply: natural next connection (recall `sent` → `booked` + create appointment).

### 12. Owner dashboard ✅ — MVP finale 🎉
- [x] **"Revenue Recovered" hero metric** on the clinic-admin dashboard (`/clinic`): return
      visits driven by recall reminders × the clinic's average visit value (PKR).
- [x] "Recovered" = a recall in status `sent`/`booked`/`completed` whose patient then had a
      `completed` appointment on/after the reminder — correlated `EXISTS` (raw SQL on the same
      pool per the db/index.ts analytics policy), all clinic-scoped.
- [x] Owner setting `clinics.avg_visit_value` (migration 0009, default 3000) editable inline via
      `AvgVisitValueForm` → `updateClinicSettings` (validated, clinic-scoped).
- [x] Supporting stat cards: Return visits · Recalls sent · Upcoming appts · Patients · Staff
      (each index-backed COUNT; the last three deep-link to their pages).
- [x] Verified with a seeded clinic_admin + a recall→completed-appointment scenario: dashboard
      200, hero renders **Rs 5,000** (1 return visit × 5,000 avg), settings form present; test data
      cleaned up. Typecheck green.

---

## 🎉 MVP complete (CLAUDE.md §11 steps 1–12)

All twelve build-order steps are done. Per CLAUDE.md §11, **stop here** — do NOT build derma,
hair, mobile apps, or advanced analytics until instructed. Config left to go live (owner's task):
`ANTHROPIC_API_KEY` + `OPENAI_API_KEY` (scribe), an AiSensy account + approved
`AISENSY_RX_CAMPAIGN`/`AISENSY_RECALL_CAMPAIGN` templates + `WHATSAPP_WEBHOOK_TOKEN` +
`LINK_SIGNING_SECRET` (WhatsApp/recalls), `CRON_SECRET` (Vercel cron), and the deploy-time
scaling fixes in "Deployment & scaling". Deferred within-MVP items: billing/usage (Steps 5–6),
payments (Step 11), audit log.

---

## Deployment & scaling (DEFERRED — handle at server deploy, not now)

Current settings are deliberate MVP/local defaults. Under load (~1000 concurrent
requests) the failure points are known and must be addressed **before production**:

- **DB connection pool** — `core/db/index.ts` uses a single pool `max: 10`. On
  Vercel serverless each instance opens its own pool → concurrent instances can
  exhaust Postgres `max_connections` (~100) → "too many connections" errors.
  **Fix:** put a pooler in front (PgBouncer / Neon / Supabase pooler / Vercel
  Postgres) and tune `max` to `pooler_limit ÷ expected_instances`.
- **Login CPU / event-loop block** — `auth/password.ts` uses **bcryptjs (pure JS,
  cost 12)**, chosen for no native build on Windows. Pure-JS hashing runs *on*
  the Node event loop (~250ms each), so a burst of logins serializes and stalls
  all other requests. **Fix (prod):** native `bcrypt`/`argon2` (thread pool) or a
  worker thread, and **rate-limit `/login`** per IP.
- **No rate limiting** anywhere — add per-IP throttling (login + general) so a
  burst/abuse can't take the app down.
- **Session validation hits the DB every request** (`sessions ⋈ users`). Fine for
  now; consider a short-TTL cache if it becomes hot.
- **Verify with a real load test** against a **production build** (`npm run build
  && npm start`), not `next dev` — e.g. `autocannon` or `k6`. Dev numbers are
  meaningless for capacity.

> Reads (indexed, tenant-scoped) hold up for bursts; the real risks are login
> CPU and serverless connection exhaustion. Owner's call: tackle at deploy time.

---

## How to run the DB (local Postgres)

1. In `.env.local`, set `DATABASE_URL` — replace `YOUR_PASSWORD` with your Postgres password.
2. Create the database (once):
   `psql -U postgres -c "CREATE DATABASE klenic;"`
3. Apply migrations: `npm run db:migrate`
4. Seed the first super admin: `npm run db:seed` (set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` first).
5. `npm run dev`, open http://localhost:3000, log in with the seeded admin → lands on `/admin`.

Other DB commands: `npm run db:generate` (new migration after schema change) ·
`npm run db:push` (dev-only quick sync) · `npm run db:studio` (browse data in a GUI).

> **This machine:** local Postgres runs on **port 5433** (not the default 5432); `.env.local`
> reflects that. Migration `0000` applied and a super admin is seeded — login works.

---

## Change log

| Date | Change |
|------|--------|
| 2026-07-05 | Created PROGRESS.md tracker. Confirmed empty project; at Step 1. |
| 2026-07-05 | Scaffolded Next.js 16 (TS strict, Tailwind v4, App Router, `src/`, `@/*` alias). |
| 2026-07-05 | Restored CLAUDE.md — create-next-app had clobbered it to a single `@AGENTS.md` line; full guardrails recovered, import kept. |
| 2026-07-05 | Built §3 folder tree (`/core`, `/modules/dental`, `/config`) with `.gitkeep`s. |
| 2026-07-05 | Installed `@supabase/supabase-js`, `@supabase/ssr`, `zod`. Wired browser+server Supabase clients and validated env. |
| 2026-07-05 | Initialized shadcn/ui; relocated `button.tsx`→`core/ui`, `utils.ts`→`core/lib` to honor §3. |
| 2026-07-05 | **Step 1 complete** — typecheck + `next build` green. Next: Step 2 (Auth). |
| 2026-07-05 | Git 2.55 installed; repo initialized (`main`). Added `.gitattributes` (LF normalization) and `.idea` ignore. |
| 2026-07-05 | Pushed to GitHub: https://github.com/bilalaziz456/klenic (origin/main). |
| 2026-07-06 | **Step 2 (Auth) complete** — roles, login/signup, session proxy, route protection, role guards, placeholder panels. Module-agnostic (authorizes by role, never specialty). Typecheck + build green. |
| 2026-07-06 | Next 16 learning: `middleware.ts` convention deprecated → renamed to `src/proxy.ts` (`export function proxy`), per bundled docs. |
| 2026-07-06 | Fixed Grammarly hydration warning (`suppressHydrationWarning`); set Klenic metadata; `/` now redirects to `/login`. |
| 2026-07-06 | **Decision revised:** removed public signup entirely — accounts are admin-provisioned only (Super Admin → clinics + clinic admins; clinic admin → staff). Deleted `/signup` page/form/action + login link; specialty checkboxes move to Step 5. Build green. |
| 2026-07-06 | **Major rework: Supabase → local PostgreSQL + Drizzle + custom session auth.** Removed `@supabase/*`; added drizzle-orm/pg/bcryptjs/drizzle-kit/tsx/dotenv. New DB layer (`core/db/index.ts` + `schema.ts`), custom auth (`session.ts`/`password.ts`/`constants.ts`), Edge-safe proxy, seed script. Generated migration `0000_*`. Updated CLAUDE.md §2/§5/§8/§10/§11. Typecheck + build green. |
| 2026-07-06 | **DB live end-to-end.** Postgres on port 5433; created `klenic` DB, applied migration `0000`, seeded super admin. Verified: `/login` 200, `/admin` 307→login, form renders. Login works in browser. |
| 2026-07-06 | **Step 3 (Core DB schema) complete.** Added `patients`, `appointments`, `visits`, `recalls` (module-tagged, status enums, JSONB note, indexed by clinic_id). Added `byClinic()` tenant helper. Migration `0001` applied → 7 tables. Typecheck + build green. |
| 2026-07-06 | **Step 4 (Module registry) complete.** `ModuleDefinition` contract + dental module (scribe prompt, recall rules, PK drug formulary) + `/config/modules.ts` registry with specialty catalog (dental available; derma/hair coming_soon). Golden rule verified: /core imports no module. Build green. |
| 2026-07-06 | **Step 5 (Super Admin panel) complete.** `/admin` clinics list, create-clinic-with-admin (transaction) + specialty checkboxes from registry, clinic detail with module toggles + staff. Added shadcn checkbox/table/badge. Verified authed pages render 200 (Dental selectable, derma/hair coming soon). Build green. Billing deferred. |
| 2026-07-06 | **Super Admin management tier complete.** `must_change_password` (migration 0002) + forced `/change-password` flow; reset staff password (revokes sessions); rename clinic; suspend/reactivate accounts; delete clinic (confirm-by-name, cascades). Verified force-change redirect (flag on → /admin 307 → /change-password 200). Build green. Auth bits reused by Step 6. |
| 2026-07-06 | **Login switched from email → username.** Added `users.username` (unique, migration 0003, backfilled admin@klenic.local → `admin`); email now optional contact. Updated login/create-clinic forms, signIn, seed (`SEED_ADMIN_USERNAME`), displays. Verified: login form shows Username, credential check passes (admin/change-me-now). Login now: **admin** / change-me-now. |
| 2026-07-06 | **UI polish.** Reusable `PasswordInput` with show/hide eye (login, change-password, create-clinic). Font → Plus Jakarta Sans (the `--font-sans` var was previously unwired → browser default). Teal brand palette in light+dark (primary/ring/accent/charts). Admin top bar: removed duplicate "Admin" on the left (now "Klenic" wordmark), username pill on right. Colored auth backgrounds. Verified via curl. |
| 2026-07-06 | **Edit clinic staff.** Super admin can edit a staff member's full name + username (unique-checked, `updateStaffProfile`) from the clinic detail page, alongside the existing rename-clinic. Verified staff row + Edit control render (200). Build green. |
| 2026-07-06 | **Per-account dark/light/system theme.** `users.theme` enum (migration 0004, default system) + mirrored `klenic_theme` cookie; no-flash inline script applies `.dark` before paint and follows OS for "system". `ThemeToggle` (System/Light/Dark) in headers persists via `setThemePreference` action + cookie; login seeds the cookie from the account's saved theme. Verified: dark→html.dark, light→none, script present. Root layout now dynamic (reads cookie). |
| 2026-07-06 | **UI/UX fixes.** Keyed inputs to kill Base UI defaultValue warning (staff/rename edits); Chrome autofill kept on-theme in dark (unlayered box-shadow); unified solid input surface (`--input-bg`) so inputs look identical everywhere; clearer dark borders; create-clinic now redirects to the list. |
| 2026-07-06 | **Clinics search + perf rule.** Name search on `/admin` (URL `?q=`, debounced, case-insensitive). Saved standing memory: build every data op for fastest response. Added pg_trgm GIN index on `clinics.name` (migration 0005). |
| 2026-07-06 | **Step 6 (Clinic Admin panel) complete.** `/clinic` dashboard (counts) + staff (add doctor/receptionist, suspend/reset) + patients (add, search by name/phone). All clinic-scoped via `byClinic()`. Trigram indexes on patients name/phone (migration 0006). Verified 200s + role isolation. |
| 2026-07-07 | **UI: brand logo + panel chrome.** Vector-traced `logo2.png` → theme-aware SVGs (`logo.svg`/`logo-dark.svg`) with refined Plus Jakarta Sans tagline; icon-only transparent favicon set (`app/icon.svg`/`favicon.ico`/`apple-icon.png`). Locked exact logo colors into theme tokens (`--brand-teal #0FB4BB`, `--brand-blue #069FC5`, `--brand-navy #082957`; primary/ring/charts + `bg-brand-gradient`). Responsive shells: desktop sidebar + mobile hamburger drawer (animated slide/fade) for `/clinic` + `/admin`, icon+text nav, sign-out icon-only on mobile. Added `loading.tsx` boundaries (spinner) so nav doesn't linger on the old page. Mobile FAB for "New clinic". |
| 2026-07-07 | **Scaling review (deferred to deploy).** Analyzed ~1000-request behavior; documented deploy-time fixes in "Deployment & scaling" section: pool `max:10` → needs a connection pooler on serverless; bcryptjs (pure-JS) login blocks the event loop → native bcrypt/argon2 + login rate-limit; no rate limiting yet; load-test on a prod build. Owner: handle at server deploy. |
| 2026-07-07 | **Step 7 (voice scribe) complete.** Generic CORE scribe: `core/integrations/storage` (local fs, clinic-namespaced), `core/ai/prompt-runner` (Anthropic SDK, `claude-sonnet-4-6`, safe JSON parse — Sonnet 4.6 lacks `output_config.format`), `core/ai/scribe-engine` (Whisper transcribe + note-gen). `POST /api/ai/scribe` (doctor-guarded, tenant-scoped) uses the clinic's MODULE prompt → saves a DRAFT visit. Doctor UI: `/doctor` shell + `ScribeWorkspace` (MediaRecorder → review → approve) + generic `NoteEditor`. Migration 0007: `visits.ai_draft`+`audio_key` (flywheel). Drug-formulary warnings. Verified end-to-end (auth→patient→module→storage→AI-key gate) via a minted doctor session; typecheck green. **Needs `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` in `.env.local` to run live.** Added `@anthropic-ai/sdk`. |
| 2026-07-07 | **Nav unified + delete/suspend UX + Step 8 (prescription PDF).** All four panels use one shared `PanelShell` (sidebar/hamburger); doctor+reception got the shell; deleted per-panel shells. Clinic staff/patients pages match the admin flow (list-first + search + `/new` page + mobile `+` FAB; table→cards on mobile with icon actions); same responsive cards+icons on the super-admin clinic-detail staff table. Delete flows: reusable `ConfirmDeleteDialog` (portal modal, step-up password re-auth via `core/auth/reauth`, autofill-proof text field with eye toggle) on staff+clinic deletes. Suspend/reactivate a clinic_admin cascades to all clinic staff (bidirectional, sessions revoked on suspend). Login now shows a distinct "suspended" message after the password verifies. Fixed duplicate-username crash (`isUniqueViolation` walks the drizzle `.cause` chain). **Step 8:** `core/lib/prescription-pdf.ts` (pdf-lib) + `GET /api/prescriptions/[visitId]` → PDF from the approved visit note, clinic-scoped, formulary-validated; doctor "Prescription" link. Verified: PDF text decoded + checked (patient/doctor/diagnosis/Rx/advice/footer). Added `pdf-lib`. Typecheck green. |
| 2026-07-07 | **Step 9 (WhatsApp) — infra.** CORE AiSensy client (`core/integrations/whatsapp`, template Campaign API, config-gated), `whatsapp_messages` log (migration 0008), notification channel (`core/notifications/whatsapp`, record-then-send), inbound webhook (`/api/whatsapp/webhook`, token-secured, logs inbound + advances outbound status on receipts, best-effort patient match). Prescription delivery: HMAC signed public link (`core/lib/signed-link`) → `/p/rx/[token]` serves the PDF session-free; doctor "WhatsApp" button. Env: APP_URL, AISENSY_*, WHATSAPP_WEBHOOK_TOKEN, LINK_SIGNING_SECRET (dev values added to .env.local). Verified end-to-end (webhook 401/200 + logged, status receipt → delivered, public link 200 PDF, tampered → 404). Needs an AiSensy account + approved template to send live. Typecheck green. |
| 2026-07-07 | **Step 10 (recall engine).** CORE `core/recall`: `scheduleRecall` (capture) + `processDueRecalls` (sends due reminders via the WhatsApp channel, specialty-agnostic). Capture wired into `approveVisit` from the note's `nextVisit`. Cron `GET /api/cron/recalls` (CRON_SECRET, Bearer/?token) + `vercel.json` daily 09:00. Success → recall `sent`; failure → stays `pending` (retry) with the attempt logged; no phone → skipped. Clinic `Recalls` page + nav (responsive table/cards). Verified: cron 401 unauthorized, authorized run `{processed:1,sent:0,skipped:1}` on a seeded due recall, pending retained + failed WhatsApp row logged when unconfigured; recalls page 200. Env: AISENSY_RECALL_CAMPAIGN, CRON_SECRET. Typecheck green. |
| 2026-07-07 | **Step 11 (receptionist panel) — appointments + WhatsApp queue.** `/reception` appointments list (patient+doctor, status badges, confirm/complete/cancel/no-show icon actions, responsive table→cards, mobile + FAB); `/reception/new` schedule form (patient picker + doctor select + datetime + reason); `/reception/whatsapp` queue (inbound+outbound from the Step 9 log, patient-matched). Reception nav = Appointments + WhatsApp. Actions: createAppointment / setAppointmentStatus / searchClinicPatients (tenant-scoped). Verified with a seeded receptionist: all pages 200, appointment + inbound message render, actions + nav present. Payments DEFERRED (provider accounts). Typecheck green. |
| 2026-07-09 | **Reschedule wording/status fix (light).** A WhatsApp reschedule now (a) **preserves the appointment's status** — a `confirmed` appointment stays confirmed after a move (it's not a new request needing re-approval), instead of being downgraded to `scheduled`; and (b) sends an accurate **"Your appointment has been rescheduled to \<time\> with Dr X. Fee: Rs …"** message via the generic reschedule reply, instead of the previous "Appointment confirmed …" (which was misleading). `checkDoctorSlot` now also returns the fee. Decided NOT to make reschedule pending-until-confirm (unlike new bookings) — a move to an already-validated slot shouldn't add staff re-approval. Verified 6/6 (confirmed stays confirmed, scheduled stays scheduled, correct message, no booked-notice). Suite 47/47. |
| 2026-07-09 | **WhatsApp booking is pending until staff confirm.** A WhatsApp self-booking is now a *request*: the appointment is tagged `appointments.source='whatsapp'` (migration 0015) and the patient gets a "booking request received — the clinic will confirm shortly" ack (not a premature "confirmed"). When the receptionist/clinic admin **Confirms** it, `setAppointmentStatus` sends the patient the confirmation with slot/timing/doctor/fee (`notifyAppointmentBooked`). Staff-created bookings (`source='staff'`) still confirm immediately at booking and are NOT re-notified on confirm (gated by source + prior status). Verified 7/7: whatsapp booking → pending ack + no confirmation; staff confirm → confirmation with Dr + fee; staff booking → immediate + no double. Suite 47/47. |
| 2026-07-09 | **Patient self-booking via WhatsApp** (respects doctor visiting hours). A matched patient can text e.g. "book with Dr Khan monday 3pm"; the webhook runs `handleBookingReply` (`core/appointments/booking.ts`) after the reschedule check: resolves the doctor (named / the clinic's only doctor / else asks which, listing each doctor's hours), parses date+time, validates against the doctor's hours/leave/daily cap (`checkDoctorSlot`), creates the appointment (status `scheduled`), and confirms — or replies with the hours / the reason. Requires an explicit date AND time; "cancel" messages are excluded. New env `AISENSY_BOOKING_REPLY_CAMPAIGN`. Verified end-to-end (webhook): valid slot creates the appt, off-day refused with hours, no-date → guidance-with-hours, two-doctor selection by name, cancel-not-booked — 6/6; suite 47/47. |
| 2026-07-09 | **Reschedule: weekday parsing.** `parse-when.ts` now resolves weekday names (full + abbreviations, optional "next"/"this") to the next upcoming occurrence — e.g. "reschedule next monday 3pm". Word-boundary matching so "next month" is NOT read as Monday. Verified 9/9 (all weekdays, no-time-keeps-existing, natural phrasing, negative case). |
| 2026-07-09 | **Reschedule: broadened intent.** `isRescheduleIntent` now also fires on "postpone" and move/change/shift/rebook when the message names an appointment/booking/slot/visit (and NOT on unrelated "I'll move to Lahore"). Verified across 15 date-format + phrasing cases. |
| 2026-07-09 | **UI: consistent time picker.** Replaced the native `<input type="time">` (inconsistent clock icon / clipped AM-PM across devices) with hour/minute/AM-PM `<select>` dropdowns in the doctor schedule editor; stored value stays "HH:MM" 24h. |
| 2026-07-08 | **UI polish: mobile schedule editor + dashboard links.** Doctor working-days rows stack cleanly on mobile; avg-visit-value Save button aligned + status centred; keyed the input to kill the Base UI defaultValue warning; dashboard "Upcoming appts" → `/clinic/appointments`, "Recalls sent" → `/clinic/recalls`. |
| 2026-07-09 | **Patient self-service reschedule via WhatsApp reply.** A matched patient can reply e.g. "reschedule 12 Jul 3pm"; the inbound webhook runs `handleRescheduleReply` (core/appointments): finds their next upcoming appointment, parses the date/time (`parse-when.ts`, heuristic — ISO / DD-MM / "12 Jul" / today|tomorrow + am-pm|24h), validates the new slot against the doctor's leave/hours/daily cap, moves the appointment (resets the reminder), and confirms with full details — or replies with clear guidance / the reason it couldn't. Extracted the booking slot-validation into shared `core/appointments/availability.ts` (`checkDoctorSlot`) so booking AND reschedule enforce identical rules (createAppointment now uses it too). New env `AISENSY_RESCHEDULE_CAMPAIGN`. Verified end-to-end (webhook): valid slot moves the appt + confirmation, off-day slot refused with reason, no-date → guidance — 8/8; suite 46/46. |
| 2026-07-09 | **Day-before appointment reminder (WhatsApp, daily cron).** `sendDueAppointmentReminders(now)` in `core/notifications/appointment.ts` scans active appointments scheduled TOMORROW that aren't reminded yet (patient has phone) and sends a WhatsApp reminder with doctor + time. Idempotent via new `appointments.reminder_sent_at` (migration 0014; stamped on success, left null to retry on failure). Cron `GET /api/cron/reminders` (CRON_SECRET, Bearer/?token — same shape as recalls) + `vercel.json` daily 18:00. New env `AISENSY_REMINDER_CAMPAIGN` (default `appointment_reminder`; params {{1}} patient/{{2}} doctor/{{3}} time/{{4}} clinic). Verified end-to-end: only tomorrow's appt reminded ("Reminder: your appointment with Dr X is on Fri 10 Jul, 10:00."); today / day-after / already-reminded / phone-less all skipped — 7/7; suite 45/45. |
| 2026-07-09 | **WhatsApp booking confirmation to patients** (doctor + working hours + fee + time). `notifyAppointmentBooked(clinicId, apptId)` in `core/notifications/appointment.ts`, wired into `createAppointment` after insert. Best-effort/clinic-scoped/phone-only, same as the cancel notice. New env `AISENSY_BOOKING_CAMPAIGN` (default `appointment_booked`; params {{1}} patient/{{2}} doctor/{{3}} time/{{4}} hours/{{5}} fee/{{6}} clinic). Body e.g. "Appointment confirmed with Dr Book on Mon 13 Jul, 10:00. Working hours: Mon 09:00–17:00…. Fee: Rs 2,000. — Clinic". Verified 6/6; suite 43/43. |
| 2026-07-09 | **WhatsApp notice to patients when an appointment is cancelled** (with doctor name + time). New CORE `core/notifications/appointment.ts` `notifyAppointmentsCancelled(clinicId, ids)` — best-effort, clinic-scoped, only messages patients with a phone, never throws (a notify failure can't undo the cancellation). Wired into BOTH cancellation paths: manual `setAppointmentStatus(...,'cancelled')` and bulk cancel from `addDoctorLeave`. Uses the standard WhatsApp channel (logs every attempt, no-ops gracefully when unconfigured); new env `AISENSY_CANCEL_CAMPAIGN` (default `appointment_cancelled`, params {{1}} patient/{{2}} doctor/{{3}} time/{{4}} clinic). Verified end-to-end: manual + leave cancels each create an outbound notice ("Your appointment with Dr X on Mon 13 Jul, 10:00 has been cancelled."), phone-less patients get none — 6/6; suite 43/43. |
| 2026-07-08 | **Doctor leave / vacation days.** New `doctor_leaves` table (clinic-scoped date range per doctor, migration 0013). Receptionist (`/reception/doctors`) and clinic admin (`/clinic/staff/[id]`) set leave via the shared `DoctorLeaves` component → `addDoctorLeave`/`removeDoctorLeave` (both roles). Adding a leave **cancels** the doctor's active (scheduled/confirmed) appointments in the range (reports the count); booking is **hard-blocked** on leave days (checked in `createAppointment` before hours/limit), and the schedule form shows "on leave that day". Verified end-to-end with real actions: add-leave cancels the appt, booking blocked on leave day / allowed on non-leave day, remove-leave unblocks — 9/9; permanent suite 43/43. |
| 2026-07-08 | **Per-doctor consultation fee + staff "Open" → full management page.** Added `users.consultation_fee` (int PKR, migration 0012), set/edited alongside the doctor schedule (`DoctorScheduleFields` fee input; parsed in `createStaff`/`updateDoctorSchedule`). Reworked the clinic staff list: each row now shows a single **Open** button (no inline action cluster) → `/clinic/staff/[id]`, which became a full management page for any staff — edit profile (name/username), doctors' schedule + daily cap + fee, reset password, suspend/reactivate, and delete (delete now redirects to the list). Removed the old inline `staff-actions.tsx`. Verified end-to-end with real server actions: create-with-fee, edit fee, edit profile, suspend, reset password (9/9); permanent suite 43/43. |
| 2026-07-08 | **Doctor scheduling: working hours + daily appointment cap, enforced on booking.** New core `core/lib/availability.ts` (per-weekday `DayAvailability`, `isDoctorAvailableAt`, `describeAvailability`, `dayBounds`; specialty-agnostic). Schema: `users.availability` jsonb + `users.daily_appointment_limit` int (migration 0011). Clinic admin sets custom per-day hours + daily cap when **creating** a doctor (`DoctorScheduleFields` in add-staff) and edits them at `/clinic/staff/[id]` (`updateDoctorSchedule`). Booking (`createAppointment`, shared by receptionist + clinic admin) **hard-blocks** off-day / out-of-hours / over-cap bookings (0 = unlimited); the schedule form shows live "N of M appointments left" via `doctorDayAvailability`. Receptionist adjusts caps at `/reception/doctors` (`setDoctorDailyLimit`, both roles). Verified end-to-end (real server actions): create-with-schedule, off-day/out-of-hours/over-limit blocks, limit→0 unblocks — 10/10; permanent suite render checks 43/43. |
| 2026-07-08 | **Clinic Admin can now MANAGE appointments (not just view).** Generalized the appointment actions (`createAppointment`/`setAppointmentStatus`/`searchClinicPatients`) to accept `receptionist` OR `clinic_admin` via a shared `requireAppointmentsAccess()` that routes revalidate/redirect back to the caller's own panel (clinic admin → `/clinic/appointments`, receptionist → `/reception`). `/clinic/appointments` upgraded to the full manager (all appts newest-first, confirm/complete/cancel/no-show, New button + mobile FAB) reusing the reception `AppointmentActions` + `NewAppointmentForm`; added `/clinic/appointments/new`. Tenant scoping unchanged (`byClinic`). E2E: manage controls render + schedule page + clinic-B isolation + reception regression, 39/39. |
| 2026-07-08 | **Clinic Admin: read-only upcoming-appointments view.** New `/clinic/appointments` (clinic-scoped via `byClinic()`, lists scheduled/confirmed appts from now on, soonest first, responsive table→cards, no scheduling actions — reception still owns those). Added "Appointments" to the clinic nav; the dashboard "Upcoming appts" card now links here (previously pointed at `/reception`, which the role guard bounced clinic admins away from → looked like a refresh). E2E: lists upcoming appt + tenant-scoped, 38/38. |
| 2026-07-08 | **Revenue dashboard = super-admin-gated, specialty-agnostic feature.** New core `clinics.features_enabled` text[] (migration 0010) + `core/lib/features.ts` (`CLINIC_FEATURES`, `clinicHasFeature`) — optional platform features, off by default, working across dental/derma/hair alike (core never hardcodes a specialty). Super admin toggles "Revenue dashboard" per clinic on the clinic detail page (`FeaturesForm` → `updateClinicFeatures`); the clinic dashboard shows the Revenue Recovered hero + avg-visit-value setting (and the "Return visits" stat) ONLY when enabled, and skips the recovered analytics query when off (perf-first). E2E extended to cover feature ON (shown) + OFF (hidden) + the admin toggle: 36/36. |
| 2026-07-08 | **E2E smoke test harness** (`scripts/e2e.mjs`, `npm run test:e2e`). Seeds a throwaway two-clinic world + real SHA-256 sessions, exercises every panel + API route over HTTP (auth, role isolation, tenant scoping, Revenue Recovered, prescription PDF + signed link, WhatsApp webhook, recall cron, scribe unconfigured/tenant, bcrypt round-trip), then cleans up (incl. orphaned audio). Full pass **35/35**. Note: the recurring Turbopack "Jest worker" dev 500 on cold route compile is environmental — clear `.next` + restart, not a code bug. |
| 2026-07-07 | **Step 12 (owner dashboard) — MVP finale.** `/clinic` dashboard rebuilt around a "Revenue Recovered" hero: return visits from recall reminders × `clinics.avg_visit_value` (migration 0009, default 3000, editable via `AvgVisitValueForm` → `updateClinicSettings`). "Recovered" = a `sent`/`booked`/`completed` recall whose patient later had a `completed` appointment on/after the reminder (correlated `EXISTS`, raw SQL on the same pool, clinic-scoped). Supporting stat cards (Return visits, Recalls sent, Upcoming appts, Patients, Staff). Verified with a seeded clinic_admin + recall→completed-appt scenario: dashboard 200, hero = Rs 5,000 (1×5000), settings form present; data cleaned up. Typecheck green. **All 12 MVP steps complete — stop per CLAUDE.md §11.** |
