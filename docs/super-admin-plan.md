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

### 5.1 v1 — manual billing layer (build this; small)
- **Per-clinic plan/price** — `clinics.plan` (free-text or a tiny `plans` list) +
  `monthly_price` + `billing_cycle` (monthly/annual). Set from clinic detail.
- **Subscription-payment ledger** (`clinic_payments`, mirrors `patient_payments`): amount,
  date, method (bank/cash/cheque), reference, **period covered** (e.g. Jul 2026), note,
  recorded-by. Super admin records each payment received.
- **Derived status** → `paid` / `due` / `overdue` (from the price + latest covered period)
  → feeds the **§1 clinic status** (overdue can prompt/auto-suspend, your call).
- **Revenue view** = Σ recorded payments → **MRR + "who's paid this month" + overdue list**
  on `/admin` (real numbers, from actual receipts — not projections).
- **Optional:** a printable company invoice/receipt PDF (reuse the invoice PDF frame).

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
