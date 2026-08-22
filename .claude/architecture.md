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
`deploy/install-cron.sh` is the ONE definition of the six jobs and their schedules;
it renders and installs `/etc/cron.d/flexicaai`, calling `/api/cron/*` on loopback
with `CRON_SECRET`. `vercel.json` is inert. Installing is a two-part step —
`core` (4 pure-DB jobs) then `all` (+ the 2 that need WhatsApp).
**Why:** follows from ADR-009. The schedule was briefly duplicated between a static
`deploy/flexicaai.cron` and the installer; that file is gone, since two copies of a
schedule drift exactly like two copies of a bill formula (ADR-014).
**Consequence:** *a job that is never invoked produces no error*, so every failure
mode here is silent and the installer has to catch them up front rather than leave
them to be noticed weeks later. It refuses to write anything until the app answers
and the secret really authenticates (a 401/503 caught at install, not at 03:00), and
`install-cron.sh check` re-asserts the two that break quietly afterwards: the cron
user existing, and that user being able to READ the secret file — the env file is
`0640 root:<run-user>`, because `0600 root:root` is unreadable by the very user the
cron line runs as. `runCron` logs every completion, so absence is detectable too.

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
`::int` can never overflow.
**The input is now bounded too (D-17, closed 2026-08-21)** — in four places, because
this is the field that caused it: the form clamps as you type (a `max` attribute only
constrains the spinner, not typing), a zod `superRefine` rejects it at the action (the
bound depends on the discount TYPE, so it cannot sit on the field), the core
`saveAppointmentProcedures` write path clamps, and a **DB CHECK** makes it true
whatever writes. A percentage over 100 was never a bigger discount — the maths already
treated everything ≥ 100% as free — so capping loses no figure.

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
`Accepted` *(implemented — D-04 and D-05 both closed)*
Shared presentation → `core/ui`. Panel-specific → colocated under that panel. The nav
map is **data passed into** `PanelShell`, not baked into it.
**Why:** `/doctor` and `/reception` redirect to `/clinic` yet still hold 30+ live
files that `/clinic` and `/admin` import, and `core/ui/panel-shell.tsx` encodes every
route, feature flag and capability slug in the product.
**Consequence:** a reader could not tell which code was live. Resolved by moving the
27 still-reachable files into the clinic workspace beside the routes that use them
(and the genuinely shared ones into `core/ui`), then deleting the 19 route shells.
`/doctor` and `/reception` are now a single optional catch-all redirect each, so old
bookmarks still land — the redirect was never the problem, the live tree beneath it
was. **Cross-group imports under `src/app` are now zero**, verified mechanically.

Two placements worth knowing: `config/module-trash.ts` resolves module trash
providers, so it sits at the registry layer — the only layer allowed to name modules —
not in core and not in a route group. And `endImpersonation` moved to
`core/auth/actions.ts` because the CLINIC shell renders its Exit button; importing it
from `@/app/admin/actions` pulled a 1,300-line module into every clinic page's graph.

**The nav is data now (D-05).** `core/ui/panel-shell.tsx` renders whatever `PanelNav`
it is handed; each panel owns its own map (`app/clinic/nav.ts`, `app/admin/nav.ts`).
Gating is declared ON the item — `resource` / `cap` / `feature` / `gate` — and applied
uniformly, replacing a `visible()` chain that hardcoded seven `/clinic/...` hrefs
inside shared chrome. The shell's icon imports went from 33 to 5, which is the
clearest measure of how much application knowledge was living in `core/ui`.

One mechanical constraint shapes this: a nav item carries a Lucide COMPONENT, and a
function can't cross the server→client boundary as a prop. So each panel has a
three-line client wrapper (`clinic-shell.tsx`, `admin-shell.tsx`) that imports its own
nav and forwards the rest. Adding a page is a change to that panel's `nav.ts` alone.

**ADR-022 — The author-only rule has exactly one exception, and it lives in the
ACL** · *2026-08-21* · `Accepted` *(implemented — D-18 closed)*
ADR-007 says only a draft's author may approve it. That rule is enforced in a WHERE
clause, so **no permission could ever relax it** — which meant a clinician's deletion
stranded their unapproved notes permanently and invisibly (D-18). The fix is a new
`handover` resource (`view` / `create` / `delete`), held by `clinic_admin` via
`ALL_PERMISSIONS` and grantable to anyone, that widens the predicate — and **only**
for a draft whose author can no longer authenticate.

**Why a separate resource, not a `clinical` action:** it is a different authority in
kind, not a larger dose of the same one — `clinical` says you document YOUR patients,
`handover` says you may finish a colleague's. Same reasoning that split `refund` out
of `billing:delete`. (`PERM_ACTIONS` is a closed vocabulary, so an `approve_others`
action was not available anyway.)

**The narrowness is the design, not a limitation.** A grant that unlocked ANY
colleague's draft would let an admin sign a note while its author sat in the next
room — trading ADR-007 away for the whole clinic to fix the rare case. The predicate
(`core/clinical/drafts.ts#authorIsStranded`) means soft-deleted **or** suspended/
deactivated **or** purged. Suspension counts because the test is *cannot log in*, and
it is reversible: reactivating hands the draft straight back, which is why the delete
dialog offers suspending as the safer option.

**Attribution needed no schema change** — `visits.doctor_id` (dictated) and
`visits.approved_by` (signed) already existed, so the record carries both truths; the
patient timeline now renders the second only when it differs from the first.

**Consequence:** one predicate, `draftAccessCondition`, serves open/approve/discard.
D-16 was precisely the bug of that rule living in one of the three and being forgotten
in the other two, so it must never be inlined at a call site again.

**ADR-023 — The audit log is bounded by an owner's choice, not by an engineer's
default** · *2026-08-22* · `Accepted` *(implemented — D-11 closed)*
`activity_logs` is append-only under ADR-006 and `view` rows dominate it. Retention is
now configurable (`company_settings.activity_log_retention_days`, pruned nightly by
`GET /api/cron/log-retention`), **defaulting to 0 = keep everything**, with a 90-day
floor on any window that is set.
**Why default to off:** this is the audit trail over patient data (CLAUDE.md §10) —
evidence of who opened which record. How long it must survive is a regulatory question
for the market, not a number to pick in code. The machinery exists so the table CAN be
bounded; it stays inert until someone decides. This is also the only hard delete in the
audit path, deliberately — soft-deleting audit rows would leave the growth problem
exactly as it was.
**The second half was the real defect.** `logView` ran a SELECT then an INSERT, and
**no index served the SELECT** — Postgres walked the global `created_at` index across
the dedupe window and filtered, so one user opening one patient cost more as OTHER
clinics got busier. Now one `INSERT … SELECT … WHERE NOT EXISTS` against a partial
index (`activity_logs_view_dedupe_idx`, migration `0081`), which also removes the
check-then-insert race.
**Consequence — a trap worth remembering:** `IS NOT DISTINCT FROM` is NOT
btree-indexable. Collapsing the null-`entity_id` branch into that one tidy expression
silently drops the plan from an Index Only Scan to a bitmap scan plus filter, i.e. it
gives back the entire optimisation while looking cleaner. Verified on 60k rows. Keep
the two branches.
**Partitioning was considered and rejected for now** — it buys cheap bulk expiry, but
at this size a nightly `DELETE` on an indexed timestamp is enough, and range partitions
add DDL maintenance forever. Revisit when the table passes ~50M rows or the nightly
prune stops finishing quickly.

**ADR-024 — A list over many tables pages by bounding each source, not by unioning
them** · *2026-08-22* · `Accepted` *(implemented — D-07 closed)*
Trash spans nine core tables plus whatever the enabled module contributes. It now
pushes every filter — including the free-text search — into SQL, asks each source for
at most `offset + limit` rows, merges, and cuts the page; `countAll` reuses the very
same predicate closure so the total and the pages cannot disagree.
**Why not one SQL UNION**, which would page in a single round trip: every label and
detail is a formatted string (`Rs 400 · 12 Jan`, a leave's date range, a visit's
patient name) that would have to be rewritten in SQL and kept in step with the
TypeScript rendering it — and **a module cannot join a core union at all**, because
core must never import a specialty table (ADR-001). The bound was the point; one query
was not worth trading the boundary and the readability for.
**The load-bearing constraint:** a filter applied AFTER the page is cut returns short
pages and a lying total, so search had to move into SQL rather than stay in JS. It
matched deleter and clinic NAMES too, so those resolve to id sets first and fold into
each entity's WHERE.
**Consequence:** the merge holds `sources × (offset + limit)`, not the table. Deep
paging still grows linearly with the offset — acceptable, and the trigger to revisit
is someone actually paging deep, not a hypothetical.
**Two things this surfaced.** `listAllTrash` is cross-tenant by definition and was
emitting unscoped queries the guard flagged into a void; it says `unscoped` now. And a
type-excluded entity used to short-circuit to a bare `false`, producing SQL with no
`clinic_id` — the scope is appended regardless now, so the guard stays at zero.

**ADR-025 — A report aggregates at the grain it reports, and bounds itself by TIME,
not by row count** · *2026-08-22* · `Accepted` *(implemented — D-12 closed)*
Four reports selected every row in a date range and folded it in JavaScript. Each now
aggregates in SQL at the grain it actually displays:

- **P&L** — `GROUP BY date_trunc('day', …)`. The day is the finest bucket the report
  offers, so grouping there loses nothing and bounds the result by the LENGTH OF THE
  RANGE (~365 rows for a year) instead of by how busy the clinic is. Days are folded
  into weeks/months by the existing TS `startOfBucket`, so the bucketing rule is **not**
  duplicated into SQL.
- **Cash summary / day book** — `GROUP BY (kind, method)`. `aggregateCash` accumulates
  whatever rows it is handed, so pre-summing needed no logic change at all.
- **Discounts** — totals via `sum(…) filter (where status …)`; the row list pages.
- **Receivables** — `GROUP BY patient`, since the output was always a list of PATIENTS
  and the appointments were only a means to it. Per-visit detail is fetched for the
  page alone.

**Where the money math lives is the constraint.** The discounts total needed the
discount in rupees, which `computeFee` owns — so `bill-sql.ts` gained ONE
`appointmentDiscountSql({ raw })` that `appointmentNetSql` is now expressed in terms
of, rather than a second copy of the clamp. Raw vs approval-gated is a parameter, not
a fork: the report shows a pending discount at its would-be value, the bill does not.

**Consequence:** `scripts/test-report-aggregation.ts` is a DIFFERENTIAL test, not a
unit test — it recomputes each figure the old way, row by row in TypeScript, from the
same seeded rows. That is the only thing that makes rewriting money arithmetic in SQL
safe (ADR-015), and it is why a sale is seeded at 23:30: the day grouping depends on
Postgres and Node agreeing where a day ends, which is the D-14 single-timezone
assumption and will need revisiting with per-clinic timezones.

**ADR-020 — The scribe is an async job** · *2026-08-21, implemented 2026-08-22* ·
`Accepted` *(was `Interim` — D-08 closed)*
`POST /api/ai/scribe` stores the audio, creates the visit as `transcribing` and
returns **202**. `core/ai/scribe-job.ts` runs Whisper + Claude from `after()` and lands
the result on the visit; the client polls until it leaves `transcribing`.
**Why the interim was not good enough:** the timeouts made a minutes-long request
survivable, not correct — it tied up a connection on the single node, forced nginx's
`proxy_read_timeout` to 300s, and had **no resume path**: a dropped run left the audio
stored and the APIs billed with nothing to show for it.

**It cost TWO statuses, not one.** The original note said "add one `visits.status`
value". `failed` is the second, and it is not optional: without it a run that dies has
nowhere to say so, and the doctor is left staring at a spinner over a real recording of
a real consultation. Both new states are excluded from every clinical surface *by
construction*, because every existing read filters `= 'draft'` or `= 'approved'`.

**Three properties hold the design up:**
- **Idempotent by claim** — the job moves the row out of `transcribing` before calling
  the provider, so a retry racing the recovery sweep does the PAID work once.
- **Recovery is a cron** (`/api/cron/scribe-recover`, 8th job). Work not tied to a
  request has nothing to retry it, so something must go looking. It marks stalled runs
  `failed` and deliberately does **not** re-run them: spending money on a provider
  unasked, in a loop, is a worse failure than a note waiting for a human to click.
- **`coalesce(transcribe_started_at, created_at)`** in that sweep. A run whose
  `after()` callback never fired has a NULL start time, and `null < cutoff` is NULL —
  so the naive comparison misses forever exactly the case the sweep exists for.

**Consequence for the deployment:** nginx no longer needs `proxy_read_timeout 300s` on
this route. `client_max_body_size 25m` is still required (CLAUDE.md §2a).
**Still unverified end to end:** no Whisper/Claude keys exist yet, so the state machine
is tested (`scripts/test-scribe-async.ts`, and e2e asserts the run settles to `failed`
with the recording kept) but a real transcription has never run through this path. One
live dictation is required when the keys land.

---

## 6. Deltas — where the code is not yet the architecture

Each is a known, accepted gap with a decision behind it. **Tick items off here as
they land.** Ordered by consequence.

| # | Delta | ADR | Status |
|---|---|---|---|
| D-01 | App files querying the DB directly. **Ratchet installed** — `eslint.config.mjs` bans `@/core/db` + `@/core/db/schema` from `src/app/**`, with a legacy allowlist that may only SHRINK | ADR-014 | Open — **42 left** (was 77, then 52). Delete lines from `LEGACY_DIRECT_DB_ACCESS` as they migrate; when it is empty, remove the exemption block. **A file that stops offending must be pruned from the list in the same change** — a stale exemption silently un-guards a file that had already been fixed |
| ~~D-07~~ | Trash loaded every soft-deleted row of 9 tables into memory | ADR-006 / ADR-024 | **Closed 2026-08-22** — see ADR-024. Every filter pushed into SQL, each source bounded to `offset + limit`, both pages paginated. `scripts/test-trash-paging.ts` |
| ~~D-08~~ | Scribe was synchronous — a minutes-long request with no resume path | ADR-020 | **Closed 2026-08-22** — 202 + `after()` job + `transcribing`/`failed` states + a recovery cron. `scripts/test-scribe-async.ts`. **A live dictation is still owed** once the AI keys exist |
| ~~D-11~~ | `activity_logs` had no retention; a view cost 2 queries, the second unindexed | ADR-006 / ADR-023 | **Closed 2026-08-22** — see ADR-023. One indexed statement per view, plus an opt-in retention window (default: keep everything). Partitioning was NOT done and is not needed at this size; the trigger is in ADR-023. `scripts/test-log-retention.ts` |
| ~~D-12~~ | Reports aggregated unbounded row sets in application code | ADR-015 / ADR-025 | **Closed 2026-08-22** — see ADR-025. P&L, cash summary, discounts and receivables all aggregate in SQL now; the two list reports page. `scripts/test-report-aggregation.ts` |
| D-13 | No test framework; no CI | ADR-005 | **On hold** (owner's direction, 2026-08-21) |
| D-14 | Timezone is server-local; blocks a second region | ADR-009 | Open — required before the first GCC clinic |
| D-15 | CSP is report-only | — | Open — enforce once the sink shows it clean |
| D-19 | No scheduled job runs on the server — the crontab is not installed | ADR-012 | **Routes done and proven** (2026-08-21: all six run, idempotent on a second pass, zero errors) and the install is now one command, `deploy/install-cron.sh`. **Installing stays on hold** (owner's direction), which is safe while pre-launch: with no live clinics all six are no-ops. Unhold in TWO parts — **WhatsApp keys** → `sudo ./deploy/install-cron.sh all` (`recalls` + `reminders` are the only two needing an API; none need Whisper/Claude). **First live clinic** → `sudo ./deploy/install-cron.sh core`, the four pure-DB jobs, gated on real data rather than keys. `reconcile` is the one not to miss: ADR-016 leaves the payment path best-effort *because* it repairs drift nightly |

**Closed:** two WhatsApp webhooks with duplicated pipelines (D-10, closed
2026-08-21 — one shared `core/integrations/whatsapp/inbound.ts`; the two providers
keep DIFFERENT sender-resolution strategies because AiSensy has one number for all
clinics and the Cloud API has one per clinic, and both are now documented side by
side so neither gets "tidied" into the other) · the 1,977-line god schema (D-09, closed 2026-08-21 — split by domain
behind a barrel; `drizzle-kit generate` reports no changes, and the tenant guard
still discovers all 39 tables / 32 tenant tables) · the nav map living in shared chrome (ADR-019, D-05 closed 2026-08-21 —
e2e asserts feature-gated items appear for a clinic with the feature and not without)
· local-FS storage on an ephemeral host (ADR-010) · in-memory limiter on a
multi-instance host (ADR-011) · API routes bypassing the auth chokepoint (ADR-013) ·
no observability (ADR-017) · silent tenant-guard (ADR-018) · webhook replay
double-booking · unbounded AI provider calls · cron secret timing leak · unsigned
webhooks accepted in production · **D-16 draft ownership unenforced on
approve/discard (ADR-007, closed 2026-08-21 — `scripts/test-draft-ownership.ts`)** ·
**D-02 six bill implementations (ADR-015, closed 2026-08-21 — one TS formula in
`fee.ts#billFromTotals`, one SQL expression in `bill-sql.ts`, bound by
`scripts/test-bill-parity.ts`)** · **D-03 untransacted derived ledgers (ADR-016,
closed 2026-08-21 — one transaction per derived set, joined to the completion event,
plus the nightly `reconcile` cron; `scripts/test-sales-reconcile.ts`)** · **D-17
percent discounts unbounded (ADR-021, closed 2026-08-21 — migration `0080` +
`scripts/test-discount-bounds.ts`)** · **D-06
unvalidated clinical jsonb (ADR-007, closed 2026-08-21 — core bounds +
module-declared shapes; `scripts/test-clinical-validation.ts`)** · **D-18 drafts
stranded by their author's deletion (ADR-022, closed 2026-08-21 — warned at delete
time, plus one narrow opt-in `handover` grant; `scripts/test-orphaned-drafts.ts`)** ·
**D-11 unbounded `activity_logs` + an unindexed view lookup (ADR-023, closed
2026-08-22 — migration `0081`; `scripts/test-log-retention.ts`)** · **D-07 Trash
loading every soft-deleted row (ADR-024, closed 2026-08-22 —
`scripts/test-trash-paging.ts`)** · **D-12 reports aggregating unbounded row sets (ADR-025, closed 2026-08-22 — `scripts/test-report-aggregation.ts`)**.

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
