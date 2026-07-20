# In-app notifications — plan

> Status: PLAN — approved 2026-07-21. CORE, specialty-agnostic. §B "platform/infra" item.
>
> **Decisions locked (2026-07-21):** v1 wires the **5-event trigger subset** (§7); the
> bell refreshes via **~60s poll + refetch-on-focus** (§6). No new ACL resource (§2).
> A bell + alerts panel: per-user notifications, unread badge, mark-read, and
> best-effort triggers on key events. No realtime/websockets in v1 (poll on open +
> light interval). Email/WhatsApp channels already exist; this adds the **in-app**
> channel + the store + the UI.

---

## 1. Guardrails (CLAUDE.md §14)

- **Core, specialty-agnostic.** Lives in `core/notifications/in-app.ts`; `type`/`entity`
  are free-text tags (never enums) so derma/hair add none. No `/modules` import.
- **Tenant-scoped.** `notifications.clinic_id` on every row; every read is
  `byClinic(clinic_id, user.clinicId, eq(user_id, user.id))` → passes the tenant guard.
- **Best-effort.** `notify(...)` never throws/blocks the triggering action (same
  contract as `logActivity` / the WhatsApp channel).
- **Self-scoped inbox.** A user only ever reads/marks their OWN notifications
  (`requireUser()` + `user_id = self`), enforced server-side.

## 2. ACL decision — **no new resource needed**

- **Viewing your own bell needs no permission** — it's self-scoped, like `/account`.
  So we add **no** `PermResource`. (Answer to "acl if necessary": not a new one.)
- **ACL is used for TARGETING** — who *receives* a notification is decided by existing
  `resource:action` permissions, so alerts only reach people who can act on them:
  - `notifyUsersWithPermission(clinicId, resource, action, payload)` resolves the
    clinic's active users, computes each one's `permissionSet` (reusing
    `core/auth/permissions.ts`), and notifies only the holders (excluding the actor).
  - `notify(clinicId, userId, payload)` targets one specific user (e.g. a doctor about
    their own payout).
- New pure helper `usersWithPermission(clinicId, resource, action)` in
  `core/auth/permissions.ts`-adjacent code (a server fn in `core/notifications` or
  `core/auth`), so targeting stays DRY and testable.

## 3. Data model — `notifications` (migration `0050`)

Transient like `activity_logs`/`sessions` → **NOT** soft-deleted / not in Trash.
Dismiss = mark read; old read rows pruned by an optional cron later.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `clinic_id` | uuid → clinics (cascade), **nullable** | NULL only for super-admin/platform (v2) |
| `user_id` | uuid → users (cascade), **NOT NULL** | the recipient; fan-out = one row each |
| `type` | text | free-text, e.g. `discount.approval_needed`, `whatsapp.inbound`, `payout.recorded` |
| `title` | text | short line shown in the list |
| `body` | text nullable | optional detail |
| `entity` | text nullable | `appointment`/`patient`/… for context |
| `entity_id` | uuid nullable | |
| `link` | text nullable | precomputed in-app URL (`/clinic/appointments/{id}`) — the bell just links |
| `actor_user_id` | uuid nullable (no FK — actors soft-delete) | who triggered it |
| `actor_name` | text nullable | snapshot |
| `read_at` | timestamptz nullable | **NULL = unread** (source of truth) |
| `metadata` | jsonb nullable | |
| `created_at` | timestamptz default now | |

**Indexes** (perf-first): partial `(user_id) WHERE read_at IS NULL` (O(index) unread
count); `(user_id, created_at DESC)` (the list); `clinic_id` (tenant scans/prune).

## 4. Core module — `core/notifications/in-app.ts`

Writes (best-effort, wrapped so a failure never bubbles):
- `notify(input)` — insert one row (`{clinicId, userId, type, title, body?, entity?, entityId?, link?, actor?, metadata?}`).
- `notifyMany(userIds, input)` — one insert, N rows (fan-out).
- `notifyUsersWithPermission(clinicId, resource, action, input, { excludeUserId? })` —
  resolve holders (§2) → `notifyMany`.

Reads (scoped to the current user):
- `getUnreadCount(clinicId, userId): number` — the partial-index COUNT.
- `listNotifications(clinicId, userId, { limit=20, beforeId? })` — newest first.
- `markRead(clinicId, userId, ids[])`, `markAllRead(clinicId, userId)`.

## 5. Server actions — `app/(shell)/notification-actions.ts` (or `core`)

All `requireUser()` + self `user_id`; clinic-scoped:
- `fetchNotifications()` → `{ items, unread }`
- `markNotificationsReadAction(ids)` , `markAllNotificationsReadAction()`
- `getUnreadCountAction()` (for the light poll)

## 6. UI — `NotificationBell` (client) in `PanelShell`

- Placed next to `ThemeToggle` in BOTH shell spots (desktop sidebar footer + mobile
  top bar). Uses a `Bell` icon with an unread **badge** (count, capped "9+").
- The **layout** (server) fetches the initial unread count + recent list once and
  passes them to the shell (props), so the badge is correct on first paint — no
  loading flash.
- Dropdown (Base UI popover): recent items (title, body, relative time, unread dot);
  clicking an item navigates to `link` and marks it read; **"Mark all read"** clears
  the badge. Empty state.
- **Refresh (no websockets in v1):** a client interval (~60s) + refetch-on-window-focus
  calls `getUnreadCountAction`; opening the dropdown calls `fetchNotifications`. Realtime
  (SSE/websockets) is v2.
- Theme-aware, mobile-friendly, keyboard-accessible.

## 7. Triggers — wire best-effort at existing action points

**v1 subset (highest value):**
1. **Discount approval needed** — in `syncDiscountApprovals` (or its callers) when a
   pending row is created: `notifyUsersWithPermission(clinic, "discount_approval","view", …)`
   for the clinic side, and `notify(theAffectedDoctor, …)` for the doctor's own row.
2. **Discount decided** (approved/rejected) — notify the appointment's creator / relevant staff.
3. **WhatsApp inbound message** — in both webhooks, when a message is attributed to a
   clinic: `notifyUsersWithPermission(clinic, "whatsapp","view", …)`.
4. **Patient self-service booking/reschedule request** (whatsapp `source='whatsapp'`) —
   notify `appointments:edit` holders (a request awaiting confirmation).
5. **Doctor payout recorded** — `notify(doctor, …)` (self), from `core/sales/payouts.ts`.

**Later (catalog, not v1):** share waived/settlement → affected doctor; lab case
"ready" → `lab:view`; appointment booked/cancelled → assigned doctor; recall batch sent.

## 8. Phasing (commit after each)

- **P1 — store + core.** schema + migration `0050`; `in-app.ts` (writes + reads +
  targeting) + `usersWithPermission`. Verify via a tsx harness (insert → count → list →
  mark) and that reads pass the tenant guard.
- **P2 — UI.** `NotificationBell` + shell wiring + layout initial fetch + actions.
  Verify rendered badge/dropdown/mark-read for a seeded user.
- **P3 — triggers.** wire the v1 subset; verify each fires to the right recipients
  (and NOT to non-holders / not to the actor).
- **P4 (optional).** prune cron (`delete read where read_at < now-30d`), refresh polish.

## 9. Out of scope (v2)

Realtime push (SSE/websockets); per-user mute/preferences; super-admin/platform-wide
notifications (clinic_id NULL bell); email digest of unread; grouping/threading.

**Realtime decision (2026-07-21):** Firebase / Redis were weighed and **deferred to v2**.
For clinic staff working in-app, the 60s-poll + on-focus refresh is the right cost/
compliance trade-off (notifications stay in our Postgres — no PII to Google). The
cheapest realtime upgrade when needed is Postgres `LISTEN/NOTIFY` + SSE (single instance,
no new vendor); Redis only at multi-instance; Firebase (FCM) only for push-to-closed-app
or a mobile app.
