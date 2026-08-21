# FlexicaAI

A modular SaaS platform for dental clinics in Pakistan and the GCC — appointments,
patients, billing, an AI voice scribe, and WhatsApp patient messaging.

The architecture is deliberately split: ~70–80% shared **core** (`src/core`) and
20–30% specialty **modules** (`src/modules`, dental today; derma and hair
transplant are architected for but not built). **Read `CLAUDE.md` before writing
code** — it holds the guardrails, and `.claude/database.md` the schema reference.

## Stack

Next.js (App Router) · TypeScript · Tailwind + shadcn/ui · PostgreSQL via Drizzle ·
custom session auth · Claude (scribe) · Whisper (transcription) · WhatsApp
(AiSensy / Meta Cloud API).

## Getting started

```bash
npm install
cp .env.example .env.local     # set DATABASE_URL at minimum
npm run db:migrate             # apply migrations
npm run db:seed                # create the first super-admin
npm run dev
```

Open http://localhost:3000. Most integrations (AI, WhatsApp, SMTP) are optional —
without their keys the app boots and those features degrade gracefully rather than
failing.

## Checks

```bash
npm run test:unit    # pure logic + a few DB-backed checks
npm run test:e2e     # full HTTP smoke test; needs the app running
npx tsc --noEmit     # typecheck
npm run lint
```

## Deployment

FlexicaAI runs on a **self-managed Linux server** (single node): Node serving
`next start` behind **nginx** for TLS, with PostgreSQL on the same box or a
neighbouring one. `CLAUDE.md` §2a is the authoritative deployment contract; the
three things most easily missed:

1. **Install the cron jobs** — `sudo ./deploy/install-cron.sh all`, then
   `./deploy/install-cron.sh check`. There is no platform scheduler, so without this
   recalls and reminders never fire, and nothing reports it.
2. **Raise nginx's `proxy_read_timeout` for `/api/ai/scribe`** (default 60s cuts
   off a normal dictation; the route budgets 300s).
3. **Back up `STORAGE_DIR` together with Postgres.** The database rows and the
   files on disk are one dataset — restoring one without the other leaves records
   pointing at attachments that no longer exist.

Single node is an assumption with teeth: local file storage and the in-memory rate
limiter are both correct on one process and silently wrong across two. Going
multi-instance means switching storage to S3 and the limiter to Redis first
(`docs/scale-plan.md` §1).
