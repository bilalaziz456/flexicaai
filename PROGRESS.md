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

---

## Environment

- Node: v24.18.0 ✅
- npm: 11.16.0 ✅
- git: **2.55.0** ✅ (repo initialized; commit identity set locally as "Bilal Aziz" &lt;bilalaziz456@gmail.com&gt;)
- Next.js: **16.2.10** (spec said "14+"; scaffold gave latest — App Router, satisfies "14+")
- React: 19.2.4 · Tailwind: **v4** · TypeScript: strict ✅
- Note: an `AGENTS.md` (added by create-next-app) warns Next 16 has API changes vs
  older docs — check `node_modules/next/dist/docs/` when unsure. Imported from CLAUDE.md.

---

## Build order (CLAUDE.md §11)

### 1. Project setup ✅
Next.js 16 (App Router) · TypeScript strict · Tailwind v4 · shadcn/ui · Supabase client
- [x] Next.js app scaffolded (App Router, TS strict)
- [x] Tailwind configured (v4)
- [x] shadcn/ui initialized — output realigned to `/core/ui` + `/core/lib` per §3
- [x] Folder structure created per CLAUDE.md §3 (`/core`, `/modules`, `/config`)
- [x] Supabase clients wired: `core/db/client.browser.ts`, `core/db/client.server.ts`
- [x] Zod-validated env (`core/lib/env.ts`): public vs server-only secrets split
- [x] `.env.example` (committed) + `.env.local` (placeholders) documented
- [x] Typecheck clean + production build passes
- **Left for you:** paste real Supabase keys into `.env.local` before running against a DB

### 2. Auth ✅
- [x] Supabase Auth login (`(auth)/login` + `signIn`/`signOut` in `core/auth/actions.ts`); no public signup (see decision)
- [x] Roles modeled: super_admin, clinic_admin, doctor, receptionist (`core/types/auth.ts`)
- [x] Session handling + route protection via Next 16 **proxy** (`src/proxy.ts`) + `core/auth/update-session.ts`
- [x] Server guards `requireUser` / `requireRole` (`core/auth/user.ts`); `signOut` action + button
- [x] Placeholder panel pages at `/admin`, `/clinic`, `/doctor`, `/reception` (role-gated; real UIs come in Steps 5-11)
- [x] Typecheck + build green
- **Design note:** role/clinic_id read from Supabase **app_metadata** (tamper-proof, admin-set) so the
  proxy can authorize from the JWT with no DB call. Step 3's `users` table becomes the canonical profile;
  role stays mirrored in app_metadata. Only `getCurrentUser()` / `updateSession()` change when we wire it.
- **Left for you:** put real Supabase keys in `.env.local`, then a Super Admin must set a user's
  `app_metadata.role` (and `clinic_id`) before they can enter a panel. Signup alone grants no access (B2B).

### 3. Core DB schema ⬜
- [ ] `clinics` (with `modules_enabled` text[])
- [ ] `users`
- [ ] `patients`
- [ ] `appointments` (with `module` field)
- [ ] `visits` (with `module` field)
- [ ] `recalls`
- [ ] RLS policies + `clinic_id` on every table

### 4. Module registry + dental skeleton ⬜
- [ ] `/config/modules.ts` registry
- [ ] `ModuleDefinition` interface
- [ ] `/modules/dental/config.ts`
- [ ] Registry exposes a "selectable specialties" list (with available/coming-soon flags)
      for the Super Admin create-clinic checkboxes (Step 5)

### 5. Super Admin panel (`/admin`) ⬜
- [ ] Service-role Supabase admin client (`core/db/client.admin.ts`) — provisions accounts
- [ ] Create clinic + select specialties (checkboxes → `modules_enabled`) + create its Clinic Admin
- [ ] Toggle modules for an existing clinic
- [ ] View billing / usage

### 6. Clinic Admin panel (`/clinic`) ⬜
- [ ] Dashboard
- [ ] Add staff
- [ ] Add patients

### 7. Doctor panel — voice scribe (`/doctor`) ⬜
- [ ] Voice recorder (client)
- [ ] Audio → Supabase Storage
- [ ] `/api/ai/scribe`: Whisper → Claude → structured note
- [ ] Draft → review → approve → save to `visits`

### 8. Prescription generator ⬜
- [ ] Dental drug formulary validation
- [ ] PDF generation
- [ ] WhatsApp delivery

### 9. WhatsApp integration ⬜
- [ ] Send/receive via AiSensy

### 10. Recall engine ⬜
- [ ] Capture next-visit date → schedule → reminder → book

### 11. Receptionist panel (`/reception`) ⬜
- [ ] Appointments
- [ ] WhatsApp queue
- [ ] Payments

### 12. Owner dashboard ⬜
- [ ] "Revenue Recovered" metric

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
