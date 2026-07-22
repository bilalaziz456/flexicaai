# Super Admin — what's built vs what a multi-clinic SaaS needs

> Written 2026-07-22. The Super Admin panel (`/admin`) is the COMPANY's control plane for
> running many clinics. This audits what exists today and lays out — in depth, prioritized
> — everything still needed to operate, bill, support, and monitor clinics at scale.
> Ties to docs/todo.md (§A commercial = v3; §Z deploy) and docs/scale-plan.md.

---

## 0. What the Super Admin can do TODAY

Grounded in the code (`src/app/admin/*`, `src/app/admin/actions.ts`):

- **Clinics list** (`/admin`) — paginated + name search; shows name · modules · created date.
- **Create clinic + first admin** (`/admin/clinics/new`) — one transaction: clinic +
  its `clinic_admin`, choose specialties (modules).
- **Clinic detail** (`/admin/clinics/[id]`) → **Settings**: name, `modules_enabled`,
  `features_enabled` (only 3: revenue_dashboard / sales / finance), `log_access`
  (which audit categories the clinic admin sees), `trash_retention_days`,
  `avg_visit_value`, per-clinic WhatsApp sender (phone-number-id / display / sender name).
  **Staff**: edit profile, reset password, suspend/reactivate. **Danger zone**: delete.
- **Activity logs** (`/admin/logs`) — every clinic's actions, paginated + filtered.
- **Trash** (`/admin/trash`) — every clinic's trashed rows: restore + legal purge.

**The mental model gap:** today's admin is a *provisioning + moderation* tool. A SaaS
control plane also needs **lifecycle, billing, usage/cost, support, and company metrics**.
None of those exist yet.

---

## ⭐ THE CORE ASK — granular per-clinic control ("disable any button", extend trial, toggle partial-payment)

The super admin should control, **per clinic**, exactly which capabilities and behaviors
are available — down to individual actions. This is achievable, and the app is **~80%
built for it already**.

### Why it's already 80% there
Almost every button/page is ALREADY behind two gates in code:
- **`can(user, resource, action)`** — the per-user ACL: ~25 resources × view/create/edit/
  delete ≈ **~100 capabilities** (`appointments:create`, `billing:create`,
  `patients:delete`, `refund:create`, `plans:edit`, …). Every button is wrapped in one.
- **`clinicHasFeature(clinic, feature)`** — coarse clinic feature flags (3 today:
  revenue_dashboard / sales / finance).

So the "which buttons show" machinery exists. We add a **super-admin CLINIC layer** on
top of the SAME catalog — no new gate at each button.

### The model: three layers, intersected
Effective capability for a user in a clinic =

> **Plan entitlement** (what the clinic PAID for)  ∩  **Clinic capability** (super-admin
> per-clinic override)  ∩  **User permission** (clinic-admin → staff)

…plus **behavior flags** for sub-features that aren't a plain CRUD action.

1. **Clinic capability grants** (super-admin) — the SAME `resource:action` catalog, but at
   the CLINIC level. Revoke `appointments:create` for a clinic → **nobody there** can
   create an appointment (the button vanishes for every role at once). Store:
   `clinics.capabilities` text[] (allowed slugs; a sentinel = "all"). Effective check
   becomes `clinicAllows(resource,action) && userHas(resource,action)` — a one-line change
   in `can()` / a `canInClinic()` wrapper, and every existing button obeys it automatically.

2. **Behavior / feature flags** (super-admin) — named toggles for things that AREN'T a
   plain CRUD action: `billing.partial_payment`, `appointments.online_booking`,
   `appointments.walk_in`, `discounts.approval`, `sales.per_line_discount`,
   `scribe.enabled`, `whatsapp.recalls`, … Grow `core/lib/features.ts` from 3 → a curated
   catalog; each flag gates its specific behavior + hides its UI.

3. **Plan entitlements** (v3) — a plan sets the DEFAULT capability/flag set; the
   super-admin per-clinic layer overrides it.

### Your exact examples, mapped
| You want | How |
|---|---|
| Disable the **Create appointment** button only | Clinic capability: revoke `appointments:create` (view/edit stay). |
| **Extend the trial** period | Operational override: edit `clinics.trial_ends_at` (+30d button on clinic detail — §1). |
| Enable/disable **partial payment** | Behavior flag `billing.partial_payment` (off → partial-pay path blocked + UI hidden). |
| Disable **any Save** button | Revoke that resource's `:create`/`:edit` for the clinic (Save = create/edit). Finer than a resource → add a targeted behavior flag. |
| Turn off **online self-booking** for a clinic | Behavior flag `appointments.online_booking` (the WhatsApp booking path). |

### The honest granularity trade-off (read this)
- **Resource:action level (recommended)** cleanly covers ~all buttons — they're grouped by
  resource — with **~100 toggles and ZERO new code per button** (the `can()` checks already
  exist). This is the sweet spot: "disable ~any button" in practice.
- **Literally one specific button** (e.g. disable the Save on ONE sub-form while leaving
  that resource's edit elsewhere) needs a **named flag per such button** → an unbounded
  catalog + a code change each. Do this only for behaviors you actually want to gate
  (partial payment, online booking, …), not universally.

→ **Recommendation:** ship (a) **resource:action clinic capabilities** + (b) a **curated
behavior-flag catalog** (extend the 3 features to ~15–25 real toggles). That delivers the
"control everything per clinic" experience without an infinite, unmaintainable flag list.

### What to build
1. **Store:** `clinics.capabilities` text[] (allowed `resource:action`; empty/sentinel =
   all) + extend `features_enabled` into the richer behavior-flag catalog
   (`core/lib/features.ts`).
2. **Unified check:** `clinicAllows(clinic, resource, action)`; make effective `can` =
   clinic ∩ user (`canInClinic()`), threaded where pages call `can`. `clinicHasFeature`
   already exists for behavior flags.
3. **Super-admin UI (clinic detail):** a **capability matrix** (like the staff permission
   grid, but clinic-level) + a **behavior-flag toggle list** + **operational overrides**
   (extend trial, status, usage limits — §1).
4. **Audit:** every toggle logged (who disabled what, which clinic, when — reuse
   `activity_logs`).
5. **Coverage pass:** verify EVERY meaningful button is behind a `can()`/feature check
   (add the few missing ones) so the toggles actually bite. Ship the guard test that
   flags an un-gated mutating action.
6. **Plan layer (v3):** entitlements set the defaults the overrides adjust.

### Effort read
The *mechanism* is small (capabilities store + a one-line `can()` intersection + a matrix
UI mirroring the existing staff grid). The *work* is the **coverage pass** (auditing that
every button is gated) + curating the behavior-flag catalog. This is a **v1-adjacent /
early-v2** build — high control value, low architectural risk (it reuses the ACL + feature
machinery already in place).

---

## 1. Clinic lifecycle & status  — **HIGH (needed for launch)**

Today "suspend" is per-user (suspending the `clinic_admin` cascades). There's no
first-class **clinic status**. For a SaaS you need one.

- **Schema:** `clinics.status` (`trial` | `active` | `suspended` | `past_due` | `cancelled`),
  `trial_ends_at`, `activated_at`, `suspended_at`, `suspend_reason`.
- **Behavior:** a non-active status **blocks all staff login** with a clear message
  ("Your clinic's access is paused — contact support/billing"), enforced in `requireRole`
  / `getSessionUser` (one check, all panels). Distinct from an individual user suspend.
- **UI:** status badge + one-click suspend/resume/cancel on the clinic detail + list;
  filter the clinics list by status.
- **Why:** you must be able to pause a non-paying or abusive clinic instantly, and see
  trials vs paying at a glance.

## 2. Clinic identity & contact  — **HIGH**

The clinic row has no owner/contact/region info — you can't reach a clinic or handle
timezones/regions.

- **Schema:** `owner_name`, `owner_email`, `owner_phone`, `country`/`region`, `city`,
  `address`, `timezone` (drives the availability/reminder TZ caveat — scale-plan/db.md),
  `notes` (internal CRM notes).
- **UI:** an "Owner & contact" card on clinic detail; region/timezone picker.
- **Why:** support, billing contact, per-region timezone correctness (the known
  single-TZ limitation), and basic CRM.

## 3. Usage & cost monitoring  — **HIGH (you're paying per AI call + WhatsApp msg)**

The scribe hits **paid** Whisper+Claude and WhatsApp is **metered** — with no visibility
you can't price, spot abuse, or forecast cost.

- **Per-clinic usage panel** (clinic detail): patients · appointments · visits (drafts vs
  approved) · **AI scribe calls** · **WhatsApp messages sent/received** · storage used ·
  active users (7/30d) · last activity. Most are `COUNT`s (already indexed);
  scribe/WhatsApp counts come from `visits`/`whatsapp_messages`.
- **Cost estimate:** approximate $ per clinic (scribe calls × unit, WhatsApp × unit) — a
  config of unit costs × the counts.
- **Company dashboard** (`/admin` home): total clinics by status, new-this-month, total
  patients/appointments, total AI + WhatsApp volume/cost, top clinics by usage.
- **Alerts:** clinics with **no activity in N days** (churn risk), **over a usage cap**,
  or erroring. (At scale, these queries must be bounded/paginated — scale-plan §2b.)
- **Why:** the two metered dependencies are a real cost center; usage also underpins any
  usage-based plan and abuse detection.

## 4. Support: impersonation ("view as clinic")  — **HIGH**

Support cannot help without seeing the clinic's workspace.

- **"Open clinic workspace"** — a super-admin starts an **impersonation session** scoped
  to one clinic (read-only or read/write, decide), heavily **audit-logged** (who, which
  clinic, when, duration), with a persistent "You are viewing {clinic} as support" banner
  and one-click exit.
- **Implement:** an impersonation token/flag on the session (super-admin id + target
  clinic id) that `requireWorkspace` honours; never expose it to clinic staff.
- **Why:** #1 support capability; every SaaS admin has it. Must be tightly audited
  (patient data).

## 5. Billing from clinics — **DECIDED: manual for v1** (automated = v3)

**Decision (2026-07-22): clinics pay Klenic MANUALLY for v1** (bank transfer / cash /
cheque — no payment gateway, no PCI scope, no dunning automation). But manual ≠ nothing:
you still need a **small ledger** to set prices, record what came in, and see revenue +
who hasn't paid. It **mirrors the `patient_payments` ledger already built** — small.

### 5.1 v1 — manual billing layer (build this; small). Model = "paid-through date + running balance"

Handles **any payment period** (2 / 3 / 5 / 12 months), a **per-clinic term the super admin
decides**, and **carry-forward when unpaid** — all with the SAME advance-credit / outstanding
math as the `patient_payments` ledger. The core idea: a **`paid_through` date** (the
subscription's valid-until) that each payment PUSHES forward.

- **Per-clinic price + term** (`clinics`): `monthly_price` (base rate) + `billing_cycle` the
  super admin sets per clinic — **monthly / 2-monthly / quarterly / half-yearly / annual**
  (just the *expected* cadence; an annual rate can be discounted via a term-price override).
  `paid_through` date = derived (subscription valid until).
- **Payment ledger** (`clinic_payments`, mirrors `patient_payments`): amount, date, method
  (bank/cash/cheque), reference, **period covered** — either an explicit `from → to` OR
  `months_covered` (e.g. 3, 5, 12) — note, recorded-by.
  - Recording a payment **extends `paid_through`** by the months it covers (pay for a year →
    +12 months; pay 2 months → +2). Paying ahead just pushes the date further out.
- **Carry-forward = the running balance** (identical to patient outstanding/credit):
  - **Owed = (months elapsed to today × `monthly_price`) − Σ payments.**
  - `paid_through ≥ today` → **paid ahead** (active; show days/months remaining).
  - `paid_through < today` → **overdue**; the gap **accrues/carries forward** automatically
    (owed grows each month it stays unpaid — no data to "re-bill", it's derived).
- **Status → lifecycle:** `active` (paid ahead) · `due` (within grace) · `overdue` (past
  grace) → feeds **§1 clinic status** (a configurable grace period, then prompt or
  auto-suspend — your call).
- **Revenue view** (`/admin`): Σ payments → **MRR / this-month collected**, **paid-through
  per clinic**, and an **overdue list with the carried-forward amount owed**.
- **Optional:** a printable company invoice/receipt PDF (reuse the invoice PDF frame).

This is the exact pattern already proven in `core/billing/*` (advance → paid-through;
outstanding → carry-forward) — just at the clinic→Klenic level, so it's a small build.

### 5.2 v3 — automated (when you scale)
- **Payment gateway** for clinic self-serve (Stripe / local), auto-charge on renewal.
- **Plans with entitlements** that DRIVE `features_enabled`/capabilities (⭐) instead of
  hand-toggling; **`clinic_subscriptions`** (period, trial, cancel-at-period-end);
  **automated dunning** (past-due → grace → auto-suspend); churn/ARPU/conversion metrics.

**Net:** v1 is a **record-payments + price + status + revenue** ledger (a few hours,
mirrors patient payments). The gateway/self-serve/dunning automation is v3.

### 5b. Company financials — "how much are WE earning?"  — **the owner's real question**

Important distinction: the clinic **Expenses / P&L / doctor-payout** modules are the
CLINIC's own money (built, §1-finance). They tell the COMPANY nothing. Klenic's earnings
are a **separate, company-level view that does NOT exist yet**:

> **Company profit = Revenue (what clinics pay Klenic) − Cost (what it costs to serve them)**

- **Revenue = MRR** — from subscriptions (§5). The headline number; doesn't exist until
  billing is built.
- **Cost = your metered spend** — **AI (Whisper + Claude) per scribe call** + **WhatsApp
  per message**, per clinic and total (§3). These are your real variable costs and scale
  per clinic; infra is roughly fixed.
- **Company dashboard** on `/admin`: MRR, new/churned revenue, total AI + WhatsApp cost,
  **gross margin (MRR − variable cost)**, and per-clinic margin (spot a clinic that costs
  more than it pays).
- **DON'T rebuild company accounting in-app.** Klenic's own staff **payroll**, rent, tax,
  and full bookkeeping belong in **dedicated accounting software (QuickBooks / Xero / an
  accountant)** — the product should expose **revenue + usage-cost + margin** and **export**
  to that tool, not replace it. (So: no "super-admin payroll module" — that's external.)
- **You can do the COST half NOW** (before billing): count scribe calls + WhatsApp
  messages per clinic × your unit costs = spend/margin-of-cost, immediately answering
  "what are these clinics costing me." Revenue (MRR) follows with §5 billing.

## 6. Internal super-admin RBAC  — **MEDIUM (as the company team grows)**

Today there's ONE `super_admin` role = full god mode. The company will have support,
billing, and engineering staff who need scoped access.

- **Schema:** super-admin sub-roles or a `permissions` array on super-admins (reuse the
  existing per-user ACL pattern) — e.g. support = impersonate + view, no delete/billing;
  billing = subscriptions + invoices; owner = everything.
- **Why:** least privilege for internal staff; audit clarity. Reuse `core/auth/permissions`.

## 7. Platform operations  — **MEDIUM**

- **Announcements / broadcast** — a banner or WhatsApp/email blast to all (or filtered)
  clinics (maintenance, new feature). Schema: `announcements` + a per-clinic dismiss.
- **WhatsApp provisioning tracker** — per-clinic template/number **approval status**
  (pending / approved / live), since go-live is multi-day per clinic (whatsapp-cloud-plan).
- **Bulk actions** — enable a feature / send a message / change plan across many clinics.
- **Data export / offboarding** — export a clinic's data (JSON/CSV) for GDPR / churn.

## 8. Scale-safety for the admin panel  — **MEDIUM (see scale-plan §2b)**

The super-admin's cross-tenant screens are the ones that break at 10k clinics:
`/admin/logs` (all activity), `/admin/trash` (`listAllTrash` scans 9 tables unbounded),
and any "all clinics" metric. These need **pagination + date bounds + indexes** before
you have thousands of clinics. (Clinics list is already paginated.)

---

## 8b. Additional needs (independent additions — don't miss these)

Things a mature multi-clinic SaaS super admin needs that aren't obvious from "manage clinics":

- **⚠️ Super-admin PANEL security — HIGH.** `/admin` is god-mode over **every clinic's
  patient data**. It needs hardening the clinic panels don't: **2FA/MFA** for super admins,
  an optional **IP allowlist** for `/admin`, **shorter session TTL** + re-auth on sensitive
  actions (delete/purge/impersonate), and email/alert on a new super-admin login. This is
  the single most important thing NOT yet covered — a compromised super-admin is a total breach.
- **Quota / limit enforcement — MEDIUM.** Set + ENFORCE per-clinic caps (max scribe calls,
  WhatsApp messages, patients, users) tied to the plan/entitlement (§5/⭐), with a soft
  alert then a hard block/throttle. Protects your API budget and enables usage-based tiers.
- **Company alerts / notifications — MEDIUM.** Proactively notify the super-admin team:
  payment failed, clinic over quota, clinic throwing errors, **churn risk** (no activity
  N days), trial ending. A super-admin notification feed (reuse the in-app bell / email).
- **New-clinic onboarding checklist — MEDIUM.** A guided setup state per clinic (admin
  created → staff added → first patient → WhatsApp provisioned → first scribe) so you can
  see who's stuck activating. Ties to §1 trial/status.
- **Data residency / region — MEDIUM (compliance).** CLAUDE.md §10 wants Pakistan data in
  a Pakistan region and GCC in-region. Region per clinic (§2) is the app hook; the physical
  residency is a deploy/infra decision (§Z / scale-plan) — but track the *intended* region.
- **Sandbox / demo clinic — LOW.** A reset-able demo clinic for sales/onboarding demos.
- **White-label / per-clinic branding — LOW (only if you sell it).** Clinic logo/colours on
  their workspace + on WhatsApp/PDF. Not needed for v1.

## 9. Priority — build order

**→ For launch (v1) — the minimum to actually operate clinics:**
1. **Super-admin panel security** (§8b) — 2FA + re-auth on destructive/impersonate. The
   panel is god-mode over all patient data; harden it FIRST.
2. **Clinic status + lifecycle** (§1) — suspend/resume, trial, login-block. *(Billing hook.)*
3. **⭐ Granular per-clinic control** (the ⭐ section) — clinic capability grants
   (resource:action) + a curated behavior-flag catalog + the super-admin matrix UI. The
   headline "disable any button / toggle partial-payment per clinic" feature.
4. **Owner/contact + region/timezone** (§2).
5. **Impersonation for support** (§4).
6. **Manual billing ledger** (§5.1) — per-clinic price + record payments received +
   paid/due/overdue status. Small (mirrors `patient_payments`). Makes revenue real.
7. **Per-clinic usage + company dashboard (revenue + cost + margin)** (§3 + §5b) — counts,
   AI/WhatsApp volume × unit cost, and **MRR from the recorded manual payments** →
   gross margin. The full "how much are we earning" view, at launch.

**→ Post-launch (v2):**
8. Internal super-admin RBAC (§6) + quotas/limits + company alerts (§8b).
9. Announcements + WhatsApp provisioning tracker + bulk actions + onboarding checklist (§7/§8b).
10. Admin cross-tenant pagination/bounds (§8) — before clinic count climbs.

**→ v3 / commercial (§A):**
11. **Automated** billing — payment gateway self-serve, plans-with-entitlements that drive
   capabilities, `clinic_subscriptions`, automated dunning, churn/ARPU (§5.2) — the
   manual v1 ledger's numbers carry over. Entitlements drive
   feature toggles.

---

## 10. Recommended first slice (one focused build)

**"Clinic lifecycle + usage + support" pack** = §1 + §2 + §3(read-only) + §4. One
migration (`clinics.status`/`trial_ends_at`/owner+region/timezone), a login-block check,
a usage panel (counts + AI/WhatsApp volume), a company dashboard, and an audited
impersonation session. That turns `/admin` from a provisioning tool into an operable
control plane — everything a launch actually needs — while leaving billing (v3) to slot
onto the `status`/`trial` hooks later.

---

# 11. BUILD SPEC — concrete deliverables

Everything below is the launch (v1) super-admin build, itemized as **schema · core · actions ·
UI · gating**. All new tables/columns land in one or two migrations; all follow the existing
patterns (soft-delete where deletable, `activity_logs` for audit, `requireRole("super_admin")`
gating). Ordered to build in sequence.

## Migration A — `clinics` columns + new tables (foundation)   ✅ SHIPPED (migration 0052, 2026-07-22)
> Note: `clinics.status` ships defaulting to **`'active'`** (not `'trial'`) so every existing
> clinic stays usable the moment the Feature 2 login-block lands; new clinics can be created as trial.

**`clinics` new columns:**
- `status` text default `'trial'` — trial | active | suspended | past_due | cancelled
- `trial_ends_at` timestamptz · `activated_at` · `suspended_at` timestamptz · `suspend_reason` text
- `owner_name` · `owner_email` · `owner_phone` · `country` · `city` · `address` text
- `timezone` text default `'Asia/Karachi'` · `region` text (intended data region)
- `monthly_price` int (PKR) · `billing_cycle` text default `'monthly'` · `grace_days` int default 7
- `capabilities` text[] (allowed `resource:action`; NULL/`['*']` = all) — granular control
- `notes` text (internal CRM)

**New `clinic_payments`** (mirrors `patient_payments`, soft-deletable):
`id · clinic_id FK cascade · amount int · method text · reference text · months_covered int
(or period_from/period_to date) · note · recorded_by uuid + recorded_by_name · occurred_at ·
softDelete + timestamps`. Index (`clinic_id`,`occurred_at`).

**`sessions` new column:** `impersonated_clinic_id` uuid null (a super-admin session acting as a clinic).

**`users` new columns (2FA, super-admins first):** `totp_secret` text null · `totp_enabled` bool default false · `totp_backup` text[] null.

## Feature 1 — Panel security (2FA + step-up + IP)   ✅ SHIPPED (2026-07-22) — 2FA login done; step-up+IP deferred
- **Core:** `core/auth/totp.ts` — RFC-6238 TOTP (Node crypto HMAC, no dep), ±1 window + hashed single-use backup codes. **Verified against the RFC 6238 vectors.** ✅
- **Flow:** super-admin login = password → **TOTP challenge** (single-action two-phase in `signIn`; failures feed the brute-force gate). ✅
- **Actions:** `beginTotpEnrollment`, `confirmTotpEnrollment(code)`, `disableTotp`, `regenerateBackupCodes` (self, password step-up). ✅
- **UI:** `/admin/security` (enroll via manual key / `otpauth://` link + 6-digit confirm + one-time backup codes) · a TOTP step on `/login`. ✅ *(QR image not rendered — manual key entry only, to stay dep-free; add a QR later if desired.)*
- **Deferred to the impersonation/suspend features:** extend `core/auth/reauth` to require a TOTP step-up on delete/purge/impersonate/suspend; optional `ADMIN_IP_ALLOWLIST` in `proxy.ts` (404 `/admin/*` from other IPs).
- **Gate:** super-admin only. ✅

## Feature 2 — Clinic lifecycle & status   ✅ SHIPPED (2026-07-22)
- **Core:** `core/clinics/status.ts` — `isClinicUsable(clinic)` (active, OR trial not expired) + `CLINIC_STATUSES`/labels/`unusableReason`. **Login-block:** enforced in **`requireRole`** (the single chokepoint every panel page + clinic mutation passes through) — a clinic-staff user whose clinic isn't usable is redirected to **`/paused`** (message + reason + sign-out). `getClinic` is request-cached so it adds no query the layout wasn't already running; super_admin (no clinic) is exempt; `/paused` uses `requireUser` so it never loops. ✅
- **Actions:** `setClinicStatus(clinicId, status, reason)` — moving to a non-usable status revokes all staff sessions (immediate lock-out; the block is the real gate, revoke is defense-in-depth), moving to active clears the suspend fields · `extendTrial(clinicId, days)` (base = later of now / current trial end, so it never shortens; re-enables a suspended clinic). Auto-derive `past_due` from billing → Feature 6. ✅
- **UI:** `ClinicLifecycle` on clinic detail — status badge + Suspend (with reason) / Resume / Activate / Cancel / Reactivate + "Extend trial +30 days"; shared `ClinicStatusBadge` + a **status filter** on the clinics list (+ Status column). ✅
- **Audit + gate:** every change logged; super-admin only (no clinic-staff ACL — this is the platform control plane). ✅
- **Verified** end-to-end over HTTP: staff blocked → /paused for suspended / past_due / cancelled / expired-trial; usable for active + future-trial; super_admin exempt; /paused bounces a usable-clinic user home; list filter + detail controls render. tsc clean.

## Feature 3 — ⭐ Granular per-clinic control   ✅ SHIPPED (2026-07-22)
- **Schema:** `clinics.capabilities` (Migration A) — a WHITELIST of allowed `resource:action`
  slugs; NULL (or a `'*'` entry) = all allowed. ✅
- **Core (the key move — "wrap `can`"):** `clinicAllows(capabilities, resource, action)` +
  `can`/`canAccess` now do **clinic capability ∩ user permission**, and `getCurrentUser` carries
  the clinic's capabilities on the user. So EVERY existing `can()` call — nav (`accessibleResourceIds`),
  page guards (`requireWorkspace`), button booleans (`canCreate=…`), and the create/edit/delete
  **server actions** — respects the super-admin's per-clinic control with **zero coverage-pass
  churn**. Undefined capabilities (super-admin, non-clinic callers) = unrestricted, so nothing
  else changed. ✅
- **Actions:** `setClinicCapabilities(clinicId, slugs[])` — stores the whitelist, or NULL when all
  usable slugs are allowed (the clean default; also lets a later-enabled feature just work). Plus
  capability upkeep folded into `updateClinic`: enabling a feature auto-allows its slugs when the
  clinic has a restricted whitelist (no silent lockout). ✅
- **UI:** a **Capabilities** card on clinic detail reusing the staff `PermissionMatrix` — all
  checked = allowed; uncheck to disable an action for every user in the clinic; "N actions
  disabled" hint + "Allow all". (Feature TOGGLES stay in the existing settings form.) ✅
- **Coverage:** achieved by the `can`-wrap (no per-button audit needed — verified the create
  button, `/new` page, nav, AND the `createAppointment` action all bite). The optional dev-guard
  for un-`can`'d mutations is deferred (speculative; the wrap already covers the real gates).
- **Audit + gate:** every capability change logged; super-admin only. ✅
- **Verified** end-to-end over HTTP (clinic_admin, so only capability — not user permission —
  varies): caps NULL → "New appointment" present; whitelist without `appointments:create` →
  button hidden, `/clinic/appointments/new` redirects, unlisted resources' nav hidden, page still
  loads via `appointments:view`; admin matrix renders. tsc clean.
- **Behavior-flag catalog** (`billing.partial_payment`, `appointments.online_booking`, …) — the
  originally-sketched second mechanism is **superseded**: `resource:action` capabilities already
  deliver "disable any button" granularly. Named behavior flags remain a possible future add for
  behaviors that don't map to a CRUD slug (e.g. walk-in vs online booking), each needing its own
  enforcement point — not built now.

## Feature 4 — Clinic identity & contact   ✅ SHIPPED (2026-07-22)
- **Schema:** owner/contact/region/timezone/notes (Migration A). ✅
- **Actions:** dedicated `updateClinicContact(clinicId, …)` (kept separate from the busy
  `updateClinic` settings save) — zod-validated (email format), empty → NULL, audited. ✅
- **UI:** an "Owner & contact" card on clinic detail — owner name/email/phone, city/country,
  **data-region** + **timezone** selects (curated PK+GCC list), address, and private internal
  notes. ✅
- **Verified** over HTTP: a full save persisted all 9 fields (timezone Asia/Dubai); a bad email
  was rejected with no write (confirmed via DB state — the prior value survived). super-admin
  only. tsc clean.

## Feature 5 — Impersonation ("view as clinic")   ✅ SHIPPED (2026-07-22) — READ-ONLY
- **Core:** `getSession` surfaces `sessions.impersonated_clinic_id`; `getCurrentUser` resolves a
  super-admin with it set as a **READ-ONLY clinic_admin** of that clinic — full VIEW of the
  workspace, but `capabilities` are clamped to `VIEW_ONLY_CAPABILITIES` (∩ the clinic's own caps)
  so no mutation `can()` passes. Real super-admin `id`/`username` stay for the audit trail. The
  Feature-2 login-block is EXEMPT for impersonation (support often views a suspended clinic).
  Never exposed to clinic staff. Decision: **read-only** (safest for patient data; a super-admin
  who must mutate does it from /admin). ✅
- **Actions:** `startImpersonation(clinicId, password, totp?)` — password step-up + a TOTP/backup
  code when the super-admin enrolled 2FA (the Feature-1 deferred step-up), heavily audited, sets
  the flag, redirects to /clinic · `endImpersonation()` reads the REAL session user (the resolved
  role is clinic_admin, so requireRole can't be used), clears the flag, audits, returns to the
  clinic detail. ✅
- **UI:** "Open workspace (view as clinic)" + step-up form on clinic detail · a persistent amber
  **"Viewing {clinic} as support — read-only · Exit"** banner in the clinic shell (new PanelShell
  `banner` prop). ✅
- **Verified** end-to-end over HTTP: no-impersonation super-admin → /clinic bounces to /admin;
  with the flag set → /clinic renders the clinic dashboard + banner, "New appointment" absent,
  `/clinic/appointments/new` redirects (read-only); suspended clinic still reachable while a
  normal staffer of it gets /paused (exemption is specific); `endImpersonation` form → 303 to the
  clinic detail + flag cleared in the DB. `startImpersonation` = proven password step-up
  (`disableTotp` pattern) + proven session write. tsc clean.
- **UI:** "Open workspace" on clinic detail · a persistent **"Viewing {clinic} as support — Exit"**
  banner in the shell when impersonating.
- **Audit:** who, which clinic, start/end — heavily logged (patient data).

## Feature 6 — Manual billing ledger  (model: paid-through + carry-forward, §5.1)   ✅ SHIPPED (2026-07-22)
- **Core:** `core/admin/billing.ts` — `computeClinicBalance(clinic, payments)` (PURE; date-driven:
  `paidThrough = (activatedAt ?? createdAt) + Σ months_covered`; `billingStatus` free/active/due(grace)/
  overdue; carried-forward `owed = monthsOverdue × price`) · `getClinicBilling(clinicId)` ·
  `recordClinicPayment` (extends paid-through, then syncs status) · `voidClinicPayment` (soft-delete +
  sync) · `listDueClinics()` (cross-tenant, `unscoped`) · `sweepClinicBillingStatus()` (the daily
  time-based downgrade). Mirrors `core/billing/*`. ✅
- **Auto-status:** `syncClinicBillingStatus` flips `clinics.status` **active↔past_due** ONLY (trial/
  suspended/cancelled untouched) — feeds the Feature-2 login-block. Recovery fires on a payment;
  the time-based downgrade rides the new **`/api/cron/billing`** daily sweep (vercel.json 03:00). ✅
- **Actions:** `setClinicPrice(clinicId, monthly, cycle, grace)` · `recordClinicPaymentAction` ·
  `voidClinicPaymentAction`. super-admin only, audited. ✅
- **UI:** a **Billing card** on clinic detail — price/cycle/grace form, balance summary (status ·
  **paid-through** · owed · total collected), record-payment form (amount · months covered · method ·
  date · reference · note), payment history + void; plus a **due/overdue list on `/admin`**. ✅
- **Verified end-to-end over HTTP:** price 5000 + activated 120d ago + no payments → card shows
  Overdue/carried-forward; `/api/cron/billing` (with CRON_SECRET) → active→**past_due** (`changed:1`);
  record-payment action (6mo/30000) → payment persisted (recordedBy=admin) + status recovered
  **past_due→active**, card shows Active/Rs 30,000/history, `/admin` overdue list cleared; voiding
  (soft-delete) + sweep → back to past_due. tsc clean.
- **Deferred (optional):** a printable company receipt PDF (reuse `InvoicePrintFrame`) — not built.

## Feature 7 — Usage & cost monitoring   ⏳ DEFERRED to FINAL-PHASE v1 (owner's call, 2026-07-22)
> The usage COUNTs are cheap, but the **cost** half needs real per-scribe / per-WhatsApp unit
> costs that only exist once the AI + WhatsApp integrations are live/billed (the §Z deploy phase).
> Build this alongside AI-key / WhatsApp go-live; it also lights up the cost + gross-margin KPIs
> on the Feature-8 company dashboard.
- **Core:** `core/admin/usage.ts` — `getClinicUsage(clinicId, range)` = COUNTs (patients ·
  appointments · visits · **scribe calls** [visits w/ `audio_key`] · **WhatsApp sent/received**
  [`whatsapp_messages`] · storage · active users 7/30d · last activity). **Cost** = usage ×
  unit-cost config (env/const: `$ per scribe`, `$ per WA msg`).
- **UI:** a **Usage & cost card** on clinic detail (this-month + trend).

## Feature 8 — Company financial dashboard ("how much are WE earning")   ✅ SHIPPED (2026-07-22)
- **Core:** `core/admin/metrics.ts` — `getCompanyMetrics(now)` (all cross-tenant aggregates inside
  ONE `unscoped`): clinics by status · new-this-month · **MRR** (Σ active `monthly_price`) ·
  **collected this month / this year** (Σ `clinic_payments`) · **overdue total/count** (reuses the
  billing balance math) · **6-month collection trend** · **top clinics by revenue**. ✅
- **UI:** `CompanyMetricsPanel` at the top of the `/admin` home — KPI cards (MRR · collected +
  trend sparkline · overdue · total clinics) + clinics-by-status breakdown + top-clinics list
  (the Feature-6 due/overdue list sits just below). ✅
- **Deferred (needs Feature 7):** AI + WhatsApp **cost** and **gross margin** require the unit-cost
  config from Feature 7 (not built) — omitted for now, noted in the module.
- **Scale note:** cross-tenant aggregates bound by date + index (scale-plan §2b); grouped/summed in
  SQL, not per-clinic loops.
- **Verified** over HTTP: seeded one active priced clinic (5000) + two payments (5000 + 15000 this
  month) → dashboard shows **MRR Rs 5,000**, **Collected this month Rs 20,000**, the clinic in Top
  clinics, status breakdown + sparkline; nested `unscoped` (metrics → listDueClinics) runs clean.
  tsc clean.

## Feature 9 — Internal super-admin RBAC   ✅ SHIPPED (2026-07-22)
- `core/auth/admin-permissions.ts` — a super-admin **capability catalog** (`clinics:manage`,
  `capabilities:manage`, `billing:manage`, `impersonate`, `announcements:manage`, `delete`,
  `purge`, `metrics:view`) stored in `users.permissions` (separate namespace; NULL = owner/all).
  Sub-role presets owner/support/billing. `canAdmin` / `isAdminOwner` / `adminSubRoleOf`. ✅
- `requireAdminCapability(cap)` + `requireAdminOwner()` guards; EVERY admin action gated by its
  capability; the `/admin` metrics panel + due list gated on `metrics:view`. ✅
- `/admin/team` (owner-only): add a super-admin with a sub-role, change sub-roles, suspend/
  reactivate (can't demote/suspend yourself). ✅
- **Verified** over HTTP: owner reaches team/announcements/metrics; a billing sub-role is
  redirected from /admin/team + /admin/announcements, keeps the clinics list + metrics. tsc clean.
- **Minor follow-up:** the admin nav still shows Team/Announcements to sub-roles that get
  redirected (guards enforce; nav isn't capability-filtered yet).

## Feature 10 — Platform ops   (partially SHIPPED 2026-07-22)
- **Announcements** ✅ — `announcements` table (0053, `clinic_id` NULL = broadcast), super-admin
  `/admin/announcements` CRUD, shown in the **clinic notice bar** (with the payment-due +
  impersonation notices). Optional WA/email blast — deferred.
- **Per-clinic data export** ✅ — `GET /api/admin/clinics/[id]/export` (super-admin +
  `clinics:manage`) downloads a full JSON dump (clinic + staff [no auth secrets] + patients /
  appointments / visits / recalls / procedures / payments / invoices / expenses / leave);
  "Export data (JSON)" link on clinic detail. Verified: 200 download, no `password_hash`/`totp`,
  403 unauthenticated.
- **Deferred (scale-triggered):** WhatsApp provisioning tracker (per-clinic number/template
  approval status — value arrives with WhatsApp go-live) · bulk actions (multi-select
  enable-feature / message / set-plan) · onboarding checklist state. Build when the manual
  version starts hurting.

## Clinic status toolkit   ✅ SHIPPED (2026-07-22, owner request)
- **Connectivity indicator** — `ConnectionStatus` in PanelShell (browser online/offline +
  `/api/ping` probe every 20s); silent while healthy, red pill offline / green on recovery.
- **Payment-due banner** — the clinic notice bar warns ALL staff while the subscription is past
  paid-through but still usable (amber "due" within grace, red "overdue" pre-lock); priced
  clinics only, via `getClinicBalanceSummary`.

## Feature 11 — Admin scale-safety   [v2, before clinic count climbs]
Pagination + date bounds + indexes on `/admin/logs` and `listAllTrash` (`collect({kind:"all"})`)
— see scale-plan §2b.

---

### Build order (v1)
1 Panel security → 2 Clinic status/lifecycle → 3 ⭐ Granular control → 4 Owner/contact →
5 Impersonation → 6 Manual billing ledger → 7 Usage/cost → 8 Company dashboard.
(2,3,4,6 share Migration A; each feature is independently committable + verifiable.)
