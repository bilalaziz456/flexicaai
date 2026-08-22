# v1 launch checklist

> Written 2026-07-21. **Verdict: no more feature-building is needed for v1.** The clinic
> app is functionally complete (MVP + post-MVP + security/perf hardening; unit + e2e
> green). What's left is a **deploy / go-live checklist** — ops + external accounts, not
> code. This is the ops companion to docs/todo.md (features) and docs/scale-plan.md
> (later-scale). Ordered by "blocks launch" vs "should-have".

---

## Key insight: single-VM launch removes two "§Z blockers"

If you launch on **one Linux or Windows VM** (not serverless), then:
- **Local file storage WORKS** (it persists on the box) — the S3 swap is only needed for
  serverless (Vercel) or multi-instance. Add **disk backups** and it's fine for launch.
- **The connection pooler is not needed** — `pool max:10` on a single instance is fine.

So on a single VM, the only §Z "storage/pooler" work is deferred to when you scale, not
launch. (On serverless/multi-instance, both become launch blockers — see scale-plan.md.)

---

## A. Hard blockers — must be done to go live

- [ ] **Host + HTTPS + domain.** A TLS cert (secure cookies + HSTS require HTTPS) on a real
      domain. (Single Linux/Windows VM is fine for v1.)
- [ ] **Production Postgres** provisioned; run migrations `0000–0051` (`npm run db:migrate`);
      confirm `pgcrypto`/`pg_trgm` extensions exist.
- [ ] **Secrets set in prod** (`.env`): `DATABASE_URL`, `APP_URL` (the public URL),
      `CRON_SECRET`, `LINK_SIGNING_SECRET` (public prescription links),
      `WHATSAPP_WEBHOOK_TOKEN`, `SEED_ADMIN_*`.
- [ ] **Seed the first super admin** in prod, then change its password.
- [ ] **Server timezone** = the clinic region (e.g. Asia/Karachi). Availability, "tomorrow"
      reminders and day-bounds use the server's local TZ (see .claude/database.md caveat).
- [ ] **Cron scheduling on the host** — `sudo ./deploy/install-cron.sh all` installs all
      six jobs (`core` = the four needing no API); it refuses to write unless the app
      answers and `CRON_SECRET` really authenticates. Confirm the next day with
      `./deploy/install-cron.sh check`. `vercel.json` is inert on this deployment.
- [ ] **`serverActions.allowedOrigins`** (next.config) = the prod domain(s), so Server
      Actions accept posts behind the real origin/proxy.
- [ ] **AI keys** — `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`, then a live record→transcribe→
      note test. *Without them the app runs but the flagship voice scribe is off.*
- [ ] **WhatsApp go-live** — **the longest-lead item; start FIRST.** Either AiSensy
      (account + approved templates) or Meta Cloud (WABA + system-user token + the 7
      Utility templates approved — see docs/whatsapp-cloud-plan.md). Recalls / reminders /
      booking confirmations / prescription delivery all depend on it. Template approval
      takes days.
- [ ] **DB backups** — automated, tested restore. Non-negotiable for patient data.

## B. Should-have — do around launch, not strictly blocking

- [ ] **Email SMTP** (`SMTP_*` / `EMAIL_FROM`) so self-service password reset actually
      sends. *Without it, an admin still resets staff passwords manually — soft.*
- [ ] **Error monitoring** — capture prod errors (Sentry, or just capture stdout/PM2/journald).
- [ ] **Trusted-proxy IP** for the rate limiter — ensure `x-forwarded-for` is set by your
      proxy (not client-spoofable). Per-username limits already mitigate.
- [ ] **Privacy policy / terms page** — healthcare data; the app tracks `data_consent` /
      `photo_consent`, but a public policy page is a legal nicety (can be a static page).
- [ ] **Manual browser QA pass** — click through login → each panel → scribe → finance →
      print pages → WhatsApp queue. (Automated e2e + HTTP checks are green, but a real
      click-through is prudent before real patients.)

## C. Optional at launch

- [x] **Enforce CSP** — done 2026-08-22 (ADR-026). Enforced on every response in two
      strengths: strict nonce + `'strict-dynamic'` on the panels, `'self' 'unsafe-inline'`
      on public pages, which may be prerendered and therefore cannot carry a nonce.
      Watch `/api/csp-report` after launch — its output should stay at zero.
- [ ] **Notification prune cron** — old read `notifications` cleanup (small; matters more
      as volume grows — scale-plan.md §2c).

## Explicitly NOT in v1 (don't wait on these)
Payment gateways · SaaS billing · marketing site (**all v3**); operational analytics ·
inventory/payroll · realtime notifications · derma/hair (**v2**); the scale-hardening
track (Redis limits, pooler, job-queue crons, partitioning — **as-needed**, scale-plan.md).

---

## Bottom line
Realistically, **you don't need to build anything more for v1.** Provision a host + prod
DB + secrets, activate the 3 external integrations (AI keys, WhatsApp, email), set up
crons + backups + timezone, do a browser QA pass — and launch. **Start the WhatsApp
approval today**; it's the only item with real external lead time.
