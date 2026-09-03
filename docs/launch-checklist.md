# v1 launch checklist

> Written 2026-07-21; **facts re-verified against the code 2026-09-03** (the migration
> range and the template count were both stale; earlier pass 2026-08-22 covered
> env vars, `allowedOrigins`, CSP, backups, timezone). **Verdict: no more feature-building is needed for v1.** The clinic
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
- [ ] **Production Postgres** provisioned; run migrations `0000–0094` (`npm run db:migrate`);
      confirm `pgcrypto`/`pg_trgm` extensions exist.
- [ ] **Secrets set in prod** (`.env`): `DATABASE_URL`, `APP_URL` (the public URL),
      `STORAGE_DIR` (an ABSOLUTE path), `CRON_SECRET`, `LINK_SIGNING_SECRET` (public
      prescription links), `WHATSAPP_WEBHOOK_TOKEN`, `SEED_ADMIN_*`.
      `.env.example` documents every one of them, and
      `npm run verify` fails if the two ever drift apart again. `env.ts` stays the
      authoritative list.
      ⚠️ **Two of those fail SILENTLY rather than loudly**, which is the dangerous kind:
      `STORAGE_DIR` defaults to the RELATIVE `./storage` — resolved against the process
      CWD, so a systemd unit with a different WorkingDirectory, or a deploy that replaces
      the app directory, puts clinical attachments somewhere you are not backing up (or
      throws them away). `APP_URL` defaults to `http://localhost:3000`, which silently
      ships that hostname inside prescription links and WhatsApp messages. Set both
      explicitly. (`CRON_SECRET` and `LINK_SIGNING_SECRET` are safe by comparison — they
      are enforced at the request boundary and fail closed in production.)
- [ ] **Seed the first super admin** in prod, then change its password.
- [ ] **Server timezone** = `Asia/Karachi`. Not cosmetic, and now load-bearing: per-clinic
      timezones are **on hold** (delta D-14), so the server's TZ is the ONLY thing that
      decides appointment slot boundaries, what the day-before reminder thinks "tomorrow"
      is, and every day bucket in the reports. A VM left on UTC puts all three ~5 hours
      out — and nothing errors, the numbers are just wrong. Set it before the first
      clinic, and re-check it after any VM rebuild.
- [ ] **Cron scheduling on the host** — `sudo ./deploy/install-cron.sh all` installs all
      eight jobs (`core` = the six needing no API); it refuses to write unless the app
      answers and `CRON_SECRET` really authenticates. Confirm the next day with
      `./deploy/install-cron.sh check`. `vercel.json` is inert on this deployment.
- [x] **`serverActions.allowedOrigins`** (next.config) = the prod domain(s), so Server
      Actions accept posts behind the real origin/proxy. **Done 2026-08-22** — derived
      from `APP_URL`, so setting that one variable configures it and the domain lives in
      exactly one place. Nothing to edit here; just set `APP_URL` to the real https URL.
- [ ] **AI keys** — `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`, then a live record→transcribe→
      note test. *Without them the app runs but the flagship voice scribe is off.*
- [ ] **WhatsApp go-live** — **the longest-lead item; start FIRST.** Either AiSensy
      (account + approved templates) or Meta Cloud (WABA + system-user token + Utility
      templates approved — see docs/whatsapp-cloud-plan.md). **NINE templates either
      way**, one per `AISENSY_*_CAMPAIGN` in `.env.example`: prescription, recall
      reminder, appointment booked / cancelled / reminder, reschedule reply, booking
      reply, invoice, lab ready. Recalls / reminders /
      booking confirmations / prescription delivery all depend on it. Template approval
      takes days.
- [ ] **nginx** — `client_max_body_size 25m` on `/api/ai/scribe`, or a normal dictation is
      rejected at the proxy before the app ever sees it. `proxy_read_timeout` no longer
      needs raising for the scribe (ADR-020 made it a background job), but the 60s default
      is still the ceiling for any future long request. TLS + HSTS terminate here; session
      cookies are `secure` in production, so **without HTTPS nobody can log in at all**.
- [ ] **Backups of Postgres AND `STORAGE_DIR` — TOGETHER, with a tested restore.**
      Non-negotiable for patient data, and the pairing is the point: they are ONE dataset
      (ADR-010). Restoring the database without the files leaves rows pointing at
      attachments that no longer exist — a chart that says a photo was taken and cannot
      show it. **Nothing in this repo does this yet**: `deploy/` contains only
      `install-cron.sh`, so the backup job is still to be written and scheduled.

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

**What actually bites, in order.** Sorted by how the failure announces itself, because
the loud ones look scarier and cost less:

1. **WhatsApp template approval** — days of external lead time, and recalls, reminders,
   booking confirmations and prescription delivery are all inert without it. Nothing
   else on this list can be started earlier or hurts more to start late.
2. **Backups (Postgres + `STORAGE_DIR` together)** — the only item here that can lose
   patient data permanently, and the only one with no code behind it yet.
3. **Silent-wrong settings**: server timezone, `STORAGE_DIR` as an absolute path,
   `APP_URL`. None of these raise an error. Each produces confidently wrong output —
   slots and reminders hours out, attachments written outside the backup, prescription
   links pointing at localhost.
4. **The crontab** (delta D-19) — a job that is never invoked produces no error either.
   Miss it and recalls, reminders and the nightly sales `reconcile` simply never run.
   `reconcile` is the one not to skip: the payment path is deliberately best-effort
   *because* it repairs drift nightly (ADR-016).
5. **HTTPS** — loud, immediate, discovered in the first five minutes of testing.
   (`allowedOrigins` is handled: it derives from `APP_URL`.)
6. **AI keys + one live dictation** — the scribe's async path has never run against a
   real provider (ADR-020 records this as owed). The app is fully usable without it;
   the flagship feature is not.
