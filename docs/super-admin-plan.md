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

## 5. SaaS billing & subscriptions  — **v3 / commercial (§A)** but design the seam now

The revenue engine. Big; explicitly v3, but the lifecycle/status fields above should be
built so plans slot in.

- **Plans** (`plans`): id, name, price, interval, **entitlements** (which modules +
  features + seat/usage limits). Entitlements should DRIVE `features_enabled` (today it's
  hand-toggled; a plan sets the baseline).
- **Subscription per clinic** (`clinic_subscriptions`): plan, status, current-period
  start/end, trial end, price snapshot, cancel-at-period-end.
- **Company invoices** (what the CLINIC pays Klenic — separate from patient invoices):
  numbered, PDF, mark-paid (manual first; gateway later).
- **Dunning:** past-due → grace → auto-suspend (drives §1 status).
- **Metrics:** MRR, churn, trial→paid conversion, ARPU.
- **Why:** none of this is needed to RUN a clinic (manual invoicing/onboarding works for
  early customers), so it's v3 — but §1's `status`/`trial_ends_at` are the hooks.

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

## 9. Priority — build order

**→ For launch (v1) — the minimum to actually operate clinics:**
1. **Clinic status + lifecycle** (§1) — suspend/resume, trial, login-block. *(Also the
   billing hook.)*
2. **Owner/contact + region/timezone** (§2).
3. **Impersonation for support** (§4).
4. **Per-clinic usage + a company dashboard** (§3, the read-only version — counts + AI/
   WhatsApp volume; cost estimate optional).

**→ Post-launch (v2):**
5. Internal super-admin RBAC (§6).
6. Announcements + WhatsApp provisioning tracker + bulk actions (§7).
7. Admin cross-tenant pagination/bounds (§8) — before clinic count climbs.

**→ v3 / commercial (§A):**
8. Plans + subscriptions + company invoices + dunning + MRR (§5) — entitlements drive
   feature toggles.

---

## 10. Recommended first slice (one focused build)

**"Clinic lifecycle + usage + support" pack** = §1 + §2 + §3(read-only) + §4. One
migration (`clinics.status`/`trial_ends_at`/owner+region/timezone), a login-block check,
a usage panel (counts + AI/WhatsApp volume), a company dashboard, and an audited
impersonation session. That turns `/admin` from a provisioning tool into an operable
control plane — everything a launch actually needs — while leaving billing (v3) to slot
onto the `status`/`trial` hooks later.
