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

### 10. Recall engine ⬜
- [ ] Capture next-visit date → schedule → reminder → book

### 11. Receptionist panel (`/reception`) ⬜
- [ ] Appointments
- [ ] WhatsApp queue
- [ ] Payments

### 12. Owner dashboard ⬜
- [ ] "Revenue Recovered" metric

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
