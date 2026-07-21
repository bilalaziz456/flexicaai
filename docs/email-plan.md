# Email notifications (code) — plan

> Status: PLAN — approved 2026-07-21. CORE, specialty-agnostic. §B "platform/infra".
> Build the code now; the SMTP **credentials + live send go-live move to §Z** (same
> "code-first" pattern as WhatsApp Cloud). Until configured, the channel gracefully
> no-ops (logs), so dev/tests never break.
>
> **Decisions locked (2026-07-21):** delivery = **SMTP via nodemailer** (portable across
> any host / SES / Resend / Postmark by setting creds); v1 scope = **password reset only**
> (staff-invite email follows later). **No new ACL resource** (reset is pre-login).

---

## 1. Why

`core/notifications/` is WhatsApp-only. The gap: **no self-service password reset** — a
user who forgets their password is stuck unless an admin resets it. This adds the email
channel + a secure forgot/reset flow. (Staff-invite email is deferred.)

## 2. Guardrails

Core, specialty-agnostic; **best-effort send** (never blocks the action, like the
WhatsApp channel); no secrets client-side. The reset flow is the security-sensitive
part — hashed single-use tokens, expiry, rate limiting, no account enumeration.

## 3. The email channel — `core/notifications/email.ts`

- **`isEmailConfigured()`** — true when SMTP host/user/pass are set (mirrors
  `isWhatsAppConfigured()`); false → `sendEmail` logs and returns `{ ok:false }` (no throw).
- **`sendEmail({ to, subject, html, text })`** — renders + sends via a nodemailer SMTP
  transport built from env. One transport, reused. Best-effort; returns `{ ok, error? }`.
- **Templates** (`core/notifications/email-templates.ts`) — small HTML+text builders,
  branded (logo/clinic name), starting with `passwordReset({ name, link, expiresMins })`.
- **Dependency:** `nodemailer` (+ `@types/nodemailer`) — boring, universal, Node-only.

**Env (all optional; validated in `core/lib/env.ts`):** `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM` (e.g. `"Klenic <no-reply@…>"`).
Added to `.env.example`; real values are a §Z step.

## 4. Data model — `password_reset_tokens` (migration `0051`)

Follows the `sessions` pattern (no clinic_id → keyed by user; not guarded/soft-deleted):

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → users (cascade) | who requested |
| `token_hash` | text **unique** | SHA-256 of the opaque token (never store the raw token) |
| `expires_at` | timestamptz | ~1 hour |
| `used_at` | timestamptz nullable | single-use (NULL = unused) |
| `created_at` | timestamptz default now | |

Index: unique `token_hash`; `user_id`.

## 5. Core reset logic — `core/auth/password-reset.ts`

- `requestPasswordReset(identifier)` — look up the user by username/email; if found,
  create a token (32-byte opaque, store its SHA-256), email the link
  (`{APP_URL}/reset-password?token=…`). **Always** returns the same shape (no
  enumeration). Rate-limited (see §6).
- `validateResetToken(token)` — returns the user if the token is unused + unexpired, else null.
- `consumeResetToken(token, newPassword)` — in a transaction: re-check validity, set the
  bcrypt hash, mark the token `used_at`, **revoke all of that user's sessions**, clear
  `must_change_password`. Returns ok/err.

## 6. Security

- **Hashed, single-use, expiring** tokens (as above).
- **No enumeration:** the forgot action always responds "If an account exists, we've
  emailed a reset link."
- **Rate limiting:** reuse `core/security/rate-limit.ts` — a new limiter (e.g. 3 / 15 min
  per identifier + per IP) on the forgot endpoint.
- **Session revocation** on a successful reset (a reset implies the account may be
  compromised).

## 7. Pages / actions — in the `(auth)` route group (public)

- **`/forgot-password`** — a page + `use server` action calling `requestPasswordReset`;
  generic success message; link from `/login` ("Forgot password?").
- **`/reset-password?token=…`** — validate the token server-side; show a set-password
  form (reuse `PasswordInput`); action calls `consumeResetToken`, then redirects to
  `/login` with a success notice. Invalid/expired token → a clear "request a new link".

## 8. Phasing (commit after each)

- **P1 — channel + store + core.** `nodemailer` dep; `core/notifications/email.ts` +
  templates + env gating; `password_reset_tokens` (migration `0051`) +
  `core/auth/password-reset.ts` (issue / validate / consume + session revoke) + the reset
  rate limiter. Verify: token lifecycle (issue → validate → consume → reused/expired
  rejected), session revocation, and that `sendEmail` no-ops-with-log when unconfigured
  (and, if a dev SMTP is handy, actually delivers).
- **P2 — pages/actions.** `/forgot-password` + `/reset-password` + the `/login` link.
  Verify end-to-end: request → token issued + email attempted → reset → **login with the
  new password works, old sessions dead**, no-enumeration response, rate limit trips.

## 9. Out of scope (later / v2)

Staff-invite email (same token mechanism, on staff creation); email verification on
new accounts; unread-notification digest; per-user email preferences; bounce/complaint
handling. Actual SMTP credentials + a live send test = **§Z go-live**.
