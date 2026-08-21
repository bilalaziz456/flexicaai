# Architecture — FlexicaAI

> **This file is the architectural source of truth.** `CLAUDE.md` holds the
> always-true guardrails; this holds the *shape* of the system, the *decisions* that
> produced it, and the *deltas* still outstanding. Imported by root `CLAUDE.md` §3/§4.
>
> **Source of truth ordering.** Code wins over this document; this document wins over
> `/docs/*-plan.md` (which are point-in-time feature plans, not the live contract).
> If you find code and this file disagreeing, the code is right and this file is
> stale — fix it in the same commit.

---

## 0. Maintenance rule (read this before you skip to §1)

**Any change to the following MUST be recorded here, in the same commit that makes
it:**

- a layer boundary or what a layer is allowed to do (§2)
- what may import what (§3)
- the module ↔ core contract (§4)
- a decision in the log (§5) — new entry, or flip an existing one to `Superseded`
- an item in the delta table (§6) — tick it off, or add one
- the deployment shape or a scaling trigger (§7)

Bug fixes, new features, new pages, new columns → **no update needed**. This file
tracks *structure and decisions*, not work. If you are unsure, ask: "would a new
engineer be misled by this file after my change?" If yes, update it.

Every decision in §5 carries a date and a status. Never delete a decision — mark it
`Superseded by ADR-nn`. The record of *why we changed our mind* is the most valuable
thing in this file.

---

## 1. Architectural style

A **modular monolith** on Next.js App Router, deployed as a **single Node process**
on a self-managed Linux server. There is no separate backend service: Server
Components read, Server Actions and Route Handlers write, and both talk to Postgres
through one Drizzle pool.

The central bet is the **core / module split** (`CLAUDE.md` §1): ~70–80% of the code
is specialty-agnostic platform (`src/core`), ~20–30% is specialty-specific
(`src/modules`). This is enforced, not aspirational — verified by there being **zero
imports from `/core` into `/modules`**, with `src/config/modules.ts` the single file
permitted to name a specialty.

```
BROWSER
├─ Server Components (read)          ─┐
└─ Client Components ──► Server Actions / Route Handlers (write)
                                      │
      src/proxy.ts (Edge) ────────────┤  coarse cookie gate · CSP nonce · x-request-id
                                      │  ⚠ NOT authorization
                                      ▼
      core/auth  ──────────────────────  checkAccess(): ONE predicate
                                         requireWorkspace → redirect
                                         apiRequireWorkspace → Response
                                      │
                                      ▼
      core/<domain>  ─────────────────  appointments · billing · sales · finance
                                         admin · recall · notifications · trash
                                         audit · patients · ai · search
                                      │
                                      ▼
      core/db  ───────────────────────  ONE pg Pool → Drizzle
                                         byClinic() + notDeleted() on every query
                                         tenant-guard backstop on every statement
                                      ▼
                                   PostgreSQL

      src/modules/<specialty>  ◄──── only src/config/modules.ts may import these
```

---

## 2. The layers and what each one owes

| Layer | Location | May do | Must never do |
|---|---|---|---|
| **Routing / presentation** | `src/app/**` | Render, gather input, call core domain functions, own `revalidatePath` | Build a Drizzle query; hold business rules; import another route group |
| **Authorization** | `core/auth` | Decide access; expose one predicate in two renderings | Let a second code path re-implement the rules |
| **Core domain** | `core/<domain>` | Own every query for its domain; take `clinicId` first; return view models | Know a specialty; know about routes/HTTP |
| **Core infra** | `core/db`, `core/integrations`, `core/observability`, `core/security`, `core/lib` | Provide a mechanism | Contain domain or specialty logic |
| **Shared UI** | `core/ui` | Generic, reusable presentation | Know application routes, features, or capability slugs |
| **Modules** | `src/modules/<specialty>` | Own specialty prompts, components, schema, rules | Be imported by core |
| **Registry** | `src/config/modules.ts` | Import concrete modules; aggregate their contributions | Leak a specialty name upward |

**The rule that is most often broken:** a page or action that writes its own query.
Every query belongs in a `core/<domain>` module. This is not about abstraction — it
is that a query written at a call site is one more place to forget `byClinic()`, and
it cannot be tested or reused. See ADR-014.

---

## 3. Dependency rules

Allowed direction only:

```
app/**  →  config/modules  →  modules/**  →  core/**
app/**  →  core/**
core/<domain>  →  core/infra
```

Forbidden, without exception:

- `core/**` → `modules/**` *(the whole point of the split)*
- `core/**` → `app/**`
- `app/<group>` → `app/<other-group>` *(route groups are routing boundaries, not
  libraries — anything two panels share belongs in `core/ui`)*
- `core/ui` → application route maps, feature flags, or capability slugs *(pass them
  in as data)*

Module-owned tables live in `modules/<specialty>/db/schema.ts`, never in the core
schema. Adding a specialty must touch only `/modules` and the registry. **If adding a
module would require changing core, the abstraction is wrong — fix the abstraction,
don't special-case the module.**

---

## 4. The module contract

A specialty is a `ModuleDefinition` (`core/types/module.ts`) registered in
`config/modules.ts`. It contributes: a scribe prompt, drug formulary, recall rules,
procedure and treatment templates, an optional structured clinical record (chart UI +
`saveRecord` + trash provider), and nav items.

Core reads `clinic.modules_enabled` and asks the registry. **Core never asks "is this
dental?"** — that check appearing anywhere in `src/core` is a defect.

---

## 5. Decision log

Status: `Accepted` (in force) · `Interim` (in force, but a known stepping stone) ·
`Superseded`.

---

**ADR-001 — Modular monolith with a core/module split** · *project start* ·
`Accepted`
One Next.js app, no separate backend. Specialty code isolated behind a registry.
**Why:** the product must add derma and hair without a rewrite, but a services split
at this size would cost far more than it returns.
**Consequence:** core must stay specialty-agnostic even when a special case would be
quicker. That discipline is the asset.

**ADR-002 — Next.js App Router is the backend** · *project start* · `Accepted`
Server Actions + Route Handlers instead of a separate API service.
**Consequence:** authorization must be enforced server-side in every entry point;
there is no gateway to centralise it. Hence ADR-013.

**ADR-003 — PostgreSQL + Drizzle over one pool; raw SQL where it pays** ·
*2026-07-06* · `Accepted`
Drizzle by default; `db.execute(sql\`…\`)` on the *same* pool for heavy aggregation.
**Why:** Drizzle is a thin query builder, so the cost is type-safety only where it
helps; analytics read better as SQL.
**Consequence:** never create a second Pool. Hand-written SQL that mirrors TS logic
needs a test binding the two (see ADR-015).

**ADR-004 — Custom session auth, not a third-party provider** · *2026-07-06* ·
`Accepted`
`users` + `sessions`, opaque token in an HTTP-only cookie, only its SHA-256 stored.
**Why:** healthcare data residency and no vendor in the auth path.
**Consequence:** we own rotation, lockout, and reset flows.

**ADR-005 — Tenant isolation in the query layer, with a guard — not Postgres RLS** ·
*2026-07-21* · `Accepted`
`byClinic()` on every tenant query is the boundary; `core/db/tenant-guard.ts`
inspects every statement as a backstop and flags any tenant-table query with no
`clinic_id`.
**Why:** RLS needs a per-request DB session and connection pinning, which breaks
pooling and parallelism. The guard targets the actual failure mode — a developer
forgetting a filter — at near-zero cost.
**Consequence:** the guard is only as useful as its output is watched. It warns in
production and throws under `TENANT_GUARD_STRICT=1`. See ADR-018.

**ADR-006 — Nothing is hard-deleted** · *2026-07-xx* · `Accepted`
Soft delete on every deletable table, with a `delete_group` so a cascade restores as
one batch. The only physical delete is a super-admin legal purge.
**Consequence:** every read must filter `notDeleted()`, and the working set only
grows — so list queries over trashed data must paginate in SQL (delta D-07) and
`activity_logs` needs a retention policy (delta D-11).

**ADR-007 — AI output is always a draft** · *project start* · `Accepted`
Scribe output lands as `status: draft`; a clinician holding `clinical:create`
approves it, and only its author may approve. The frozen `ai_draft` is kept.
**Why:** clinical safety, and the accuracy flywheel.
**Consequence:** gate on the PERMISSION, never the `doctor` role — in this market the
owner is usually the practising dentist. (A role check here was a real bug, fixed
2026-08-21.)
**And the note is VALIDATED before it becomes the record.** It arrives as `jsonb`
from the browser, so core applies generic bounds (object, depth, size, list length —
`core/clinical/note-schema.ts`) and the enabled module supplies the SHAPE
(`ModuleDefinition.noteSchema` / `chartSchema`, declared beside the `scribePrompt`
that asks for it). Deliberately permissive: unknown keys are KEPT, every field is
optional, and only the fields the app actually reads are type-checked — several valid
note shapes already exist (the scribe's, and imported historical visits), and
over-strictness would reject real records rather than fail safe.

**ADR-008 — Two-tier access control** · *2026-07-xx* · `Accepted`
Effective access = **clinic capability ∩ user permission**. Super admin sets the
clinic's capabilities; the clinic admin grants per-user `resource:action` slugs.
`can()` applies both.
**Consequence:** permission logic stays pure (no DB, no `server-only`) so the server
guard and the client permission grid share one source of truth.

**ADR-009 — Self-managed Linux server, single node** · *2026-08-21* · `Accepted`
Node running `next start` behind nginx (TLS), Postgres alongside. Replaces Vercel.
**Why:** owner's direction; also matches the single-node-first architecture.
**Consequence:** this decision is load-bearing for ADR-010 and ADR-011, and it moves
three responsibilities to us — job scheduling, request timeouts, and backups. See §7.

**ADR-010 — Local-filesystem storage, behind a driver seam** · *2026-08-21* ·
`Accepted` *(supersedes the plan to move to S3 before launch)*
Files live on the server's persistent disk via `core/integrations/storage`.
**Why:** on a serverless host an ephemeral filesystem would have lost clinical
attachments — that was the audit's most severe finding. A real disk removes it.
**Consequence:** `STORAGE_DIR` and Postgres are **one dataset** and must be backed up
together. The four-function seam stays so S3 remains a one-module swap; §7 names the
triggers.

**ADR-011 — In-process rate limiting** · *2026-08-21* · `Accepted`
`core/security/rate-limit.ts` keeps counters in memory.
**Why:** correct and effective on one Node process; Redis would be infrastructure
bought for a problem we don't have.
**Consequence:** silently wrong across two processes. **PM2 must run in *fork* mode,
never cluster.** See §7.

**ADR-012 — Jobs are triggered by system cron, not a platform scheduler** ·
*2026-08-21* · `Accepted`
`deploy/flexicaai.cron` calls the `/api/cron/*` endpoints on loopback with
`CRON_SECRET`. `vercel.json` is inert and kept only as the reference schedule.
**Why:** follows from ADR-009.
**Consequence:** *a job that is never invoked produces no error*. Installing the
crontab is a deployment step that fails silently if skipped — hence `runCron` logs
every completion, so absence is detectable.

**ADR-013 — One access predicate, two renderings** · *2026-08-21* · `Accepted`
`checkAccess()` decides; `requireWorkspace` renders a denial as a redirect,
`apiRequireWorkspace` as a Response.
**Why:** pages and API routes need identical rules but different outputs. Ten Route
Handlers had grown their own checks and skipped the clinic-usable and
must-change-password gates — a suspended clinic could still export its patient list.
**Consequence:** never add an auth check outside `core/auth`.

**ADR-014 — Queries live in core domain modules, enforced by lint** · *2026-08-21* ·
`Accepted` *(target; see delta D-01)*
Every query lives in a `core/<domain>` module taking `clinicId` first. `src/app/**`
may not import `@/core/db` or `@/core/db/schema`.
**Why:** 77 app files currently build queries inline, so tenant scoping is a habit
rather than a structure, and none of it is testable.
**Explicitly NOT a repository pattern.** Drizzle *is* the abstraction; wrapping it
would add indirection without removing coupling.
**Consequence:** enforced by an ESLint `no-restricted-imports` rule with an
allowlist that only ever shrinks — a visible debt counter, no big-bang refactor.
Type-only imports stay legal (they carry no query, and banning them would push
callers into hand-rolling row shapes). Two traps worth knowing if you touch the
config: a dynamic-route segment must be glob-escaped or its entry silently exempts
nothing, and a config that fails to parse reports ZERO problems — which reads exactly
like passing. Verify a rule fires on a deliberate violation before believing it.

**ADR-015 — One bill formula, with SQL bound to it by test** · *2026-08-21* ·
`Accepted` *(implemented — D-02 closed)*
ONE formula, expressed twice because it must be:
- **TS** — `fee.ts#billFromTotals(consultation, proceduresGross, proceduresNet, …)`
  is the core. `computeBill` (from lines, for the invoice/receipt/booking form) and
  `computeSaleAmounts` (for the ledger) are projections of it, not parallel formulas.
- **SQL** — `bill-sql.ts#appointmentNetSql`, composed over
  `procedures.ts#procedureRowNetSql`, for set-based queries where doing it per row in
  JS would be N+1.
- **`scripts/test-bill-parity.ts` is the contract** between them: randomised
  appointments, asserted equal to the rupee.

**Why:** six implementations answered "what does this visit cost?", kept in step by
comments — including two byte-identical SQL copies each documented as "the single
source". `computeAppointmentTotal` took ONE pre-summed procedures figure and every
server caller passed the NET, so its `gross` was post-line-discount: the appointments
list showed a struck-through "full price" that disagreed with the invoice.
**Order is the load-bearing detail:** line discounts apply first, the appointment
discount applies to the SUBTOTAL, never to the gross.
**Consequence:** any SQL mirroring TS money logic needs a differential test asserting
agreement to the rupee. That test — not the refactor — is what retires the risk, and
it earned its place immediately by finding an int4 overflow (below).

**ADR-021 — Money arithmetic in SQL runs in `numeric`, not `int4`** · *2026-08-21* ·
`Accepted`
Any percent-discount multiply casts to `numeric` before multiplying, and casts the
clamped result back to `int`.
**Why:** `discount_value` has no upper bound in the schema or in validation, so a
percent discount of e.g. 99999 is storable. `subtotal * 99999` overflows int4 and
Postgres **throws**, while TS clamps — so one side returned a number and the other
500'd every list that aggregates bills (appointments, receivables, invoices, dashboard
KPIs) for that clinic until the row was edited. Found by the parity test.
**Consequence:** the clamp makes the result always `0 ≤ net ≤ subtotal`, so the final
`::int` can never overflow. Bounding the input remains worth doing separately (D-17).

**ADR-016 — Derived state is transactional; external effects are best-effort; drift
is reconciled** · *2026-08-21* · `Accepted` *(implemented — D-03 closed)*
`sales`, `sale_shares`, `discount_settlements` and line waives are *derived* from the
appointment. Three rules:
1. **The derived set is written in ONE transaction** (`recordSaleInner`), so it can
   never be internally half-applied — revenue booked with nobody credited for it.
2. **It joins the SOURCE transaction where the source is the completion event**
   (`applyAppointmentStatus`), so "completed" and "its revenue" become true together.
   External effects — WhatsApp, audit, notifications — stay outside and best-effort:
   a provider must never roll back a clinical status change, and holding a
   transaction open across a network call is how a pool gets exhausted.
3. **Everything is reconciled** nightly (`core/sales/reconcile.ts`,
   `GET /api/cron/reconcile`), re-deriving drift through the normal write path so a
   repair can never invent a number the app wouldn't have produced.

**REFINED DURING IMPLEMENTATION —** the original wording said derived writes always
join their source transaction. Money-in does **not**: `core/billing/payments.ts`
commits the payment first and records the sale after. Coupling them would mean a bug
in share arithmetic blocks a receptionist from taking cash, and that is a far worse
failure than a delayed ledger. The trade is only sound because derived state is
**recomputable** — unlike a payment, which is a fact about the world — so rule 3 is
what makes rule 2 optional there. *Never block the user, always detect, always repair.*

**Consequence:** a function handed a `Tx` must READ through it too (`core/db/tx.ts`),
or it re-derives from the pre-update row on another connection. And the inner ledger
steps now **throw** rather than swallow: catching inside a transaction leaves it
aborted while pretending to succeed, so there is exactly ONE best-effort boundary and
it is the outermost.

**ADR-017 — Observability is ours; no vendor SDK in the code path** · *2026-08-21* ·
`Accepted`
`core/observability`: `report()` replaces bare `catch {}`, emits structured JSON to
stdout/stderr, with one optional `OBSERVABILITY_WEBHOOK_URL`.
**Why:** `CLAUDE.md` §2 (no major deps without reason) and §10 (no PII in error
trackers) point the same way. journald collects stdout for free.
**Consequence:** **redaction stays ours** and is tested — it is the only part that
doesn't fail safe. Reports carry **ids, never names**. Adding Sentry later is a change
to `deliver()` and nothing else.

**ADR-018 — The tenant guard reports through the sink; strict in CI** ·
*2026-08-21* · `Accepted`
Violations go to `report()` at `error`, not `console.error`.
**Why:** in warn mode its output went to an unmonitored void, so the backstop was
decorative. It found a real unscoped query within minutes of being wired up.
**Consequence:** the guard's output must stay at zero. A recurring known violation
trains people to ignore it — fix the query, don't mute the guard.

**ADR-019 — Route groups are routing boundaries, never libraries** · *2026-08-21* ·
`Accepted` *(target; see delta D-04)*
Shared presentation → `core/ui`. Panel-specific → colocated under that panel. The nav
map is **data passed into** `PanelShell`, not baked into it.
**Why:** `/doctor` and `/reception` redirect to `/clinic` yet still hold 30+ live
files that `/clinic` and `/admin` import, and `core/ui/panel-shell.tsx` encodes every
route, feature flag and capability slug in the product.
**Consequence:** a reader can currently not tell which code is live. That is the cost
being paid.

**ADR-020 — The scribe becomes an async job** · *2026-08-21* · `Interim`
Today: synchronous, budgeted at 300s (Whisper 120s + Claude 90s×2), needing a matching
nginx `proxy_read_timeout`.
Target: `POST` persists audio and returns a visit in a `transcribing` state; a job
fills the draft; the client revalidates.
**Why interim:** the timeouts make it survivable, not correct. Holding a request open
for minutes is a poor use of the single node, and there is no resume path.
**Consequence:** add one `visits.status` value rather than a new table.

---

## 6. Deltas — where the code is not yet the architecture

Each is a known, accepted gap with a decision behind it. **Tick items off here as
they land.** Ordered by consequence.

| # | Delta | ADR | Status |
|---|---|---|---|
| D-01 | App files querying the DB directly. **Ratchet installed** — `eslint.config.mjs` bans `@/core/db` + `@/core/db/schema` from `src/app/**`, with a legacy allowlist that may only SHRINK | ADR-014 | Open — **55 left** (was 77). Delete lines from `LEGACY_DIRECT_DB_ACCESS` as they migrate; when it is empty, remove the exemption block |
| D-04 | `/doctor` + `/reception` dead shells hold live code; cross-group imports | ADR-019 | Open |
| D-05 | `core/ui/panel-shell.tsx` owns the whole app's route map | ADR-019 | Open |
| D-07 | Trash loads every soft-deleted row of 9 tables into memory | ADR-006 | Open |
| D-08 | Scribe is synchronous | ADR-020 | Open (interim in force) |
| D-09 | `schema.ts` is a 1,977-line god module (156 importers) | — | Open |
| D-10 | Two WhatsApp webhook implementations with divergent patient matching | — | Open |
| D-11 | `activity_logs` has no retention/partitioning; a view costs 2 queries | ADR-006 | Open |
| D-12 | Reports aggregate unbounded row sets in application code | — | Open |
| D-13 | No test framework; no CI | ADR-005 | **On hold** (owner's direction, 2026-08-21) |
| D-14 | Timezone is server-local; blocks a second region | ADR-009 | Open — required before the first GCC clinic |
| D-15 | CSP is report-only | — | Open — enforce once the sink shows it clean |
| D-17 | `discount_value` is unbounded (`z.coerce.number().int().min(0)`), so a *percent* discount of e.g. 99999 is storable and meaningless. The SQL no longer breaks on it (ADR-021) and both sides clamp, but the input should be rejected: percent ≤ 100 | ADR-021 | Open — found 2026-08-21 by `test-bill-parity.ts`; a zod refine on the appointment + per-line discount schemas |

**Closed:** local-FS storage on an ephemeral host (ADR-010) · in-memory limiter on a
multi-instance host (ADR-011) · API routes bypassing the auth chokepoint (ADR-013) ·
no observability (ADR-017) · silent tenant-guard (ADR-018) · webhook replay
double-booking · unbounded AI provider calls · cron secret timing leak · unsigned
webhooks accepted in production · **D-16 draft ownership unenforced on
approve/discard (ADR-007, closed 2026-08-21 — `scripts/test-draft-ownership.ts`)** ·
**D-02 six bill implementations (ADR-015, closed 2026-08-21 — one TS formula in
`fee.ts#billFromTotals`, one SQL expression in `bill-sql.ts`, bound by
`scripts/test-bill-parity.ts`)** · **D-03 untransacted derived ledgers (ADR-016,
closed 2026-08-21 — one transaction per derived set, joined to the completion event,
plus the nightly `reconcile` cron; `scripts/test-sales-reconcile.ts`)** · **D-06
unvalidated clinical jsonb (ADR-007, closed 2026-08-21 — core bounds +
module-declared shapes; `scripts/test-clinical-validation.ts`)**.

---

## 7. Scaling posture and the triggers that change it

**Single node is a decision, not an accident** — and it is load-bearing for ADR-010
and ADR-011. Do not add a second app instance casually; two things break *silently*:

| Trigger | What breaks | Do this first |
|---|---|---|
| A second app instance, or PM2 **cluster** mode | Local storage (a file written by one node 404s on the other); the rate limiter (per-process counters) | Swap storage to S3 behind the existing seam; back `Limiter` with Redis (`docs/scale-plan.md` §1) |
| Storage outgrows the disk, or needs off-host durability | — | S3 swap |
| Job runtimes overlap their schedule | Overlapping cron runs | BullMQ + Redis (`CLAUDE.md` §2) |
| A second region (GCC) | Availability + "tomorrow" reminders read server-local time | Per-clinic IANA timezone (D-14) |

**Operational duties this deployment gives us** (`CLAUDE.md` §2a): install the
crontab; raise nginx `proxy_read_timeout` for `/api/ai/scribe`; back up `STORAGE_DIR`
*with* Postgres; monitor disk; set the server timezone; keep the process manager in
fork mode.

---

## 8. Checklist for anything new

Before writing code, in order:

1. **Core or module?** Would a dentist, dermatologist and hair surgeon use this
   identically? → `core`. Otherwise → `modules/<specialty>`.
2. **Which layer?** A query belongs in `core/<domain>`, not in a page or action
   (ADR-014). Presentation belongs in the panel, or `core/ui` if two panels share it
   (ADR-019).
3. **Is it clinic-scoped?** Then `byClinic()` + `notDeleted()`, always.
4. **Is it derived from something else?** Then write it in the same transaction as
   its source (ADR-016).
5. **Does it compute money?** Then it uses `computeBill`, and any mirroring SQL gets
   a differential test (ADR-015).
6. **Does it accept input?** zod at the boundary — including jsonb (ADR-007/D-06).
7. **Does it swallow a failure?** `report()` it, with ids and never names (ADR-017).
8. **Is it AI output?** It is a draft until its author approves it (ADR-007).
9. **Did any of this change the architecture?** Then update this file (§0).
