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

**The rule that used to be broken most:** a page or action that writes its own query.
Every query belongs in a `core/<domain>` module. This is not about abstraction — it
is that a query written at a call site is one more place to forget `byClinic()`, and
it cannot be tested or reused. 77 app files did it; as of 2026-08-22 **none do**, and
lint now enforces it with no exemptions. See ADR-014.

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
`deploy/install-cron.sh` is the ONE definition of the eight jobs and their schedules;
it renders and installs `/etc/cron.d/flexicaai`, calling `/api/cron/*` on loopback
with `CRON_SECRET`. `vercel.json` is inert. Installing is a two-part step —
`core` (6 pure-DB jobs) then `all` (+ the 2 that need WhatsApp).
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
`Accepted` *(implemented — D-01 closed 2026-08-22)*
Every query lives in a `core/<domain>` module taking `clinicId` first. `src/app/**`
may not import `@/core/db` or `@/core/db/schema`.
**Why:** 77 app files built queries inline, so tenant scoping was a habit rather than
a structure, and none of it was testable.
**Explicitly NOT a repository pattern.** Drizzle *is* the abstraction; wrapping it
would add indirection without removing coupling.
**Consequence:** enforced by an ESLint `no-restricted-imports` rule that ran as a
RATCHET — an allowlist that could only shrink, a visible debt counter rather than a
big-bang refactor. **It reached zero on 2026-08-22 and the exemption block is gone**,
so the rule now applies to `src/app/**` with no escape hatch. Type-only imports stay
legal (they carry no query, and banning them would push callers into hand-rolling row
shapes).

Three traps, all of which cost real time on the way down:

- A config that fails to PARSE reports ZERO problems, which reads exactly like
  passing. Verify the rule fires on a deliberate violation before believing it.
- A dynamic-route segment had to be glob-escaped: `[id]` is a character class in
  minimatch *and* in sed, so three allowlist entries silently exempted nothing and two
  attempts to prune them silently no-oped.
- **Codemods must be constrained by what the projection SELECTS**, not by the table in
  the FROM clause. A pass swapping inline clinic reads for `getClinic` also matched
  queries that merely JOIN `clinics`, renaming their variable and breaking eight files;
  a greedy `[\s\S]*?` in another pass ate the boundary between two functions and
  deleted ~100 lines that tsc was perfectly happy about. Prefer exact-substring edits
  that assert a match count.

The end of the list was also the hard part: `admin/actions.ts` held 33 statements
including three transactions e2e cannot reach (it signs in as clinic staff, so clinic
creation, suspension and deletion were untested). They are now `core/admin/clinics.ts`,
covered by `scripts/test-admin-clinics.ts`.

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
**Still in force, now expressed on the id column** — ADR-027 turned `discount_type`
into an FK, so the three CHECKs read `discount_type_id <> 2`. 
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

**ADR-026 — The CSP is enforced, at two strengths, because a nonce and a prerendered
page are mutually exclusive** · *2026-08-22* · `Accepted` *(implemented — D-15 closed)*
`src/proxy.ts` sends an **enforced** `Content-Security-Policy` on every response.
Everything outside `script-src` is identical in both policies. `script-src` is chosen
by `matchProtectedPrefix` — the predicate that already defines "this is a panel":

- **Panels** (`/admin`, `/clinic`) → `'self' 'nonce-…' <theme-hash> 'strict-dynamic'`.
  Every page there reads the session, so the response is always server-rendered and
  Next can nonce it. That is the entire patient-data surface.
- **Everything else** → `'self' 'unsafe-inline'`. Public pages may be prerendered, and
  they render no user input at all, so the XSS surface traded away is close to nil
  while `'self'` still refuses any third-party script.

**Why the old trigger could never fire.** D-15 said "enforce once the sink shows it
clean". The sink was never going to: the report-only policy was NOT clean and could not
be. A prerendered page's ~13 chunk tags and ~36 inline flight scripts carry no nonce —
there is no request at build time to mint one — and under `'strict-dynamic'` the host
source `'self'` is ignored, so every one of them is refused. Enforcing the old policy
blanked the JavaScript on every marketing page. Next's own docs say the same thing in
one line: nonces require that EVERY page be dynamically rendered. Making the whole app
dynamic to satisfy that would have traded away the SSG decision in `CLAUDE.md` §7, so
the policy bends instead.

**The measurement is the point.** This was settled by enforcing locally and walking the
app in a browser while watching `/api/csp-report` — 14 refusals per marketing page
view, 0 across the workspace. **Reading the report COUNT understates it**: browsers
dedupe by blocked-uri, so 36 refused inline scripts arrive as a single `"inline"` line.

**The trap that decided the shape:** `/_not-found` is prerendered too, and ANY path can
reach it — a 404 under `/clinic/…` was served from the prerender cache with all 14
scripts refused. So "is this response prerendered" is **not** a property of the request
path, and no route list could have expressed it. Each panel now owns a `[...rest]`
catch-all so an unmatched panel URL is server-rendered and nonced. It costs the 404
status (the layout has begun streaming before `notFound()` throws) — but every
`notFound()` in the panel already returned 200 for that reason, so this makes the
unmatched case consistent rather than exceptional.

**Consequences.**
- The public policy must carry **neither a nonce nor a hash**. Under CSP3 either one
  disables `'unsafe-inline'`, which puts every prerendered page straight back to blank.
  Adding the theme hash "for good measure" is the tempting mistake, and e2e asserts
  against it.
- `report-uri` stays on the ENFORCED policy. A refused script is a feature that
  silently does nothing and raises no error of its own; the report is the only thing
  that names it. Its output must stay at zero (ADR-018).
- Enforcement is on in **development too** — verified clean, so there is no
  works-in-dev-breaks-in-prod gap to fall into.
- To reach one strict policy everywhere, prerendering has to go — that is the trigger,
  and it is a `CLAUDE.md` §7 decision, not a CSP one.

**ADR-027 — Money-path vocabularies are reference tables with integer foreign keys,
and the application still sees the code** · *2026-09-02* · `Accepted`
The nine closed vocabularies the money path branches on — payment kind, clinic payment
kind, payment method, settlement kind, settlement party, approval status, discount
status, discount type, discount bearer — are TABLES, and the 16 columns carrying them
are `integer` with an FK. Supersedes the CHECK constraints of ADR-021's follow-on
migrations (`0084`/`0085`), which the FK subsumes.

**Why, and who decided.** This is the owner's call, made after the alternative was put
twice: that a value the code BRANCHES on is a code-owned vocabulary rather than data,
and that a surrogate key buys referential integrity at the cost of readable SQL. Both
costs are real and are recorded below rather than argued again. What the decision buys
is genuine: the database now refuses a value no vocabulary row has, and a lookup row
in use cannot be deleted.

**The constraint that makes a surrogate key safe: ids are WRITTEN OUT, never assigned
by a sequence.** A `serial` assigns by insertion order, so a re-seed in a different
order silently reclassifies money already recorded — a refund read back as a payment
moves a P&L and raises nothing. Every id is a literal in the migration and in
`src/core/db/vocabulary-seed.ts`, and `scripts/test-vocabulary-tables.ts` asserts the
two agree row for row. **Never renumber, never reuse a retired id** — set
`is_active = false` so historical rows still resolve.

**The load-bearing implementation decision is that the ~120 read sites did NOT change.**
`core/db/schema/vocabulary.ts#vocabularyRef` is a Drizzle `customType` storing the
integer and presenting the code, so `eq(patientPayments.kind, "refund")` still compiles
and emits `kind_id = 4`. Stripping the text columns from the schema showed what the
alternative was: 515 type errors, every one in money arithmetic or a money report,
where a mistake produces a WRONG FIGURE rather than a failure. Converting them by hand
was the largest risk in the change and was not worth taking to gain a property — the
id being visible in TypeScript — that nothing needs. The column types are literal
unions now, so a mistyped code fails to compile.

**Consequences, including what was lost:**
- `where kind = 'refund'` at a psql prompt is now `kind_id = 4`; join the lookup to
  read it. Raw SQL in the app compares against `paymentKindId("refund")`.
- **An FK enforces "exists in the table", not "is in a SUBSET of it."** `payment_methods`
  holds the four tenders plus the system marker `advance` (written only by
  `applyAdvance`). `0084`/`0085` kept `advance` out of the four non-patient method
  columns; the FK cannot, so that restriction now rests on zod alone.
- Untrusted values — a method filter from a URL — are NARROWED at the boundary
  (`asPaymentMethodCode`), never cast: an unknown value drops its condition rather
  than silently matching nothing.
- **drizzle-kit cannot generate this migration unaided**, and both failures are silent
  if unnoticed. It emits `ADD COLUMN … NOT NULL` with no default, which fails on any
  table with rows — the sequence must be add-nullable → backfill → `SET NOT NULL`, and
  a row whose value is not in the lookup must be left NULL so the `SET NOT NULL` FAILS
  rather than being mapped to something plausible. And it renders `.default("pending")`
  literally onto an `integer` column, because it does not run a custom type's
  `toDriver` when generating DDL.
- **ADR-021's percent bounds now name an ID.** The three CHECKs read
  `discount_type_id <> 2 OR discount_value between 0 and 100`, where 2 is `percent`.
  They are generated from `discountTypeId("percent")` in the schema (via `sql.raw`,
  because a constraint needs a literal, not a bind parameter) — but once written they
  are a number in the catalogue. Renumbering a vocabulary would leave them guarding the
  wrong type in silence, which is a second reason ids are never renumbered.
- The expand → migrate → contract staging is what made it reversible: `0087` added the
  ids beside the text, `0089` dropped the text only once every read went through them.
  Repeat that shape for any further vocabulary.

**Extended 2026-09-02 to the seven ENUM-backed vocabularies, and the values now come
from the DATABASE** (migration `0090`). `appointment_status`, `visit_status`,
`recall_status`, `user_role`, `theme_preference`, `whatsapp_direction` and
`whatsapp_status` are tables; their columns are integer FKs.

**The reason differs from the money-path set, and that matters.** Postgres already
refused a value outside an enum, so the FK adds NO integrity here. What it adds is a
ROW per value — and `core/db/vocabulary-cache.ts` reads the label, sort order and
active flag from those rows at start-up (`src/instrumentation.ts`). Renaming a status,
reordering a dropdown or retiring a value is now a row update, not a deploy.

**The division of ownership is the decision, and it is not negotiable by adding rows:**
the DATABASE owns how a value is PRESENTED; the CODE owns what it MEANS. `nextQueueAction`
switches on an appointment status, `plActionEffect` on a settlement kind, `can()` on a
role. A row inserted into the database alone is stored and then never acted on, so a
NEW value remains a code change. The compiled constants therefore stay — not as a
second source of truth, but as the migration seed and the list `loadVocabularies()`
CHECKS the database against, reporting any drift. They are also the cold-cache
fallback, which is safe only because that check exists: Drizzle's `customType` mappers
are SYNCHRONOUS and cannot query, so the id↔code map has to be resolvable in memory.

**Two hazards worth carrying forward:**
- An enum column cannot be cast to integer implicitly, and the `USING` transform may
  not contain a SUBQUERY ("cannot use subquery in transform expression") — it must be
  a literal `CASE`, which is consistent with ids being written down anyway. A value the
  CASE misses yields NULL and the NOT NULL then fails the migration, rather than
  quietly blanking a status.
- A PARTIAL INDEX whose predicate names the enum blocks the conversion outright
  (`operator does not exist: integer = whatsapp_direction`). Drop it before, recreate
  it against the id after.

**`activity_logs.actor_role` is deliberately NOT converted.** It is a text SNAPSHOT, in
the same family as `sales.doctor_name`: it must survive the role vocabulary changing.
Converting it would tie an audit row to a mutable table and defeat the point of a
snapshot (ADR-006's reasoning, applied to a vocabulary).

**Completed 2026-09-02 — the compiled LABEL MAPS are gone.** `APPOINTMENT_STATUS_LABEL`,
`ROLE_LABELS`, `PAYMENT_METHOD_LABEL`, `PAYMENT_METHOD_OPTIONS` and the `statusLabel` /
`paymentMethodLabel` helpers are deleted. Every label, the order values appear in, and
whether a value is still offered now comes from the database.

**Server components** read `core/db/vocabulary-cache.ts` directly. **Client components**
cannot — it is `server-only` — so the root layout takes one `vocabularySnapshot()` and
provides it through `core/ui/vocabulary-provider.tsx`; `useVocabularyLabel` and
`useVocabularyOptions` serve the sixteen that need it. A provider rather than props
deliberately: threading labels through sixteen components is the churn this design
exists to avoid.

**The cache re-reads on a 60-second TTL, and that is not a detail.** Loaded once at
start-up and never again, "renaming a label is a row update" would quietly have meant
"a row update AND a restart" — most of the benefit gone. A stale refresh does not
block the render: the current values are correct enough for one more request, and a
failed refresh leaves them in place rather than taking a page down. Verified by
renaming a method in the database and watching it change in the UI.

**Two things stayed in code, for different reasons.**
`APPOINTMENT_STATUS_VARIANT` maps a code to a shadcn Badge variant — a design-system
decision, not a property of the vocabulary; a database row could name a variant the UI
does not have. And `APPOINTMENT_STATUSES` remains, because the CODES are what the
application branches on (`nextQueueAction`) and what gives the union its literal type.
The database owns presentation; the code owns meaning, and this is where the line falls.

**A consequence to remember when writing tests:** the whole snapshot is serialised into
every page payload, so a bare text search over the HTML now finds every vocabulary label
as DATA whether or not anything rendered it. An e2e assertion that a control is absent
must look for the control, not for a status word (one such assertion broke exactly this
way and was narrowed to the button's own text).

**What this does NOT extend to.** Open vocabularies stay open: `module` above all — a
table of specialties would put a specialty name in core and break ADR-001 — plus
`activity_logs.action`/`entity`, `notifications.type`, `imported_transactions.type`
and `.method` (it archives whatever a clinic's previous system wrote), and
`ai_usage.model`. Vocabularies whose worst case is a wrong badge colour were left as
plain columns; the test to apply is ADR-021's — **does a bad value produce a wrong
FIGURE, silently?**

---

## 6. Deltas — where the code is not yet the architecture

Each is a known, accepted gap with a decision behind it. **Tick items off here as
they land.** Ordered by consequence.

**As of 2026-08-22 nothing here is merely outstanding:** every delta is either closed
or explicitly **on hold at the owner's direction** (D-13, D-14, D-19). A hold is a
decision, not a backlog item — so each one records the condition that makes it safe to
keep holding, and the event that ends it. Read that column before assuming a hold can
just continue.

| # | Delta | ADR | Status |
|---|---|---|---|
| ~~D-01~~ | App files querying the DB directly — 77 of them, each a place to forget `byClinic()` | ADR-014 | **Closed 2026-08-22** — 77 → 52 → 42 → 36 → 33 → 30 → 27 → 22 → 20 → 18 → 17 → 16 → 12 → 8 → 5 → 2 → **0**. `LEGACY_DIRECT_DB_ACCESS` is empty and the exemption block is DELETED, so `eslint.config.mjs` bans `@/core/db` + `@/core/db/schema` from all of `src/app/**` with nothing exempted; re-proved by a deliberate violation. Never reintroduce an allowlist. The last file, `admin/actions.ts`, is now `core/admin/clinics.ts` + `scripts/test-admin-clinics.ts` |
| ~~D-07~~ | Trash loaded every soft-deleted row of 9 tables into memory | ADR-006 / ADR-024 | **Closed 2026-08-22** — see ADR-024. Every filter pushed into SQL, each source bounded to `offset + limit`, both pages paginated. `scripts/test-trash-paging.ts` |
| ~~D-08~~ | Scribe was synchronous — a minutes-long request with no resume path | ADR-020 | **Closed 2026-08-22** — 202 + `after()` job + `transcribing`/`failed` states + a recovery cron. `scripts/test-scribe-async.ts`. **A live dictation is still owed** once the AI keys exist |
| ~~D-11~~ | `activity_logs` had no retention; a view cost 2 queries, the second unindexed | ADR-006 / ADR-023 | **Closed 2026-08-22** — see ADR-023. One indexed statement per view, plus an opt-in retention window (default: keep everything). Partitioning was NOT done and is not needed at this size; the trigger is in ADR-023. `scripts/test-log-retention.ts` |
| ~~D-12~~ | Reports aggregated unbounded row sets in application code | ADR-015 / ADR-025 | **Closed 2026-08-22** — see ADR-025. P&L, cash summary, discounts and receivables all aggregate in SQL now; the two list reports page. `scripts/test-report-aggregation.ts` |
| D-13 | No test framework; no CI | ADR-005 | **On hold** (owner's direction, 2026-08-21) |
| D-14 | Timezone is server-local; blocks a second region | ADR-009 | **On hold** (owner's direction, 2026-08-22) — the GCC work is not being done now. Safe while every clinic is in one country: availability, "tomorrow" reminders and day boundaries all read the SERVER's timezone and agree with each other. It stops being safe the moment a clinic sits in a different offset, so this is the **gate on the first GCC clinic**, not a nice-to-have — unhold before signing one, not after |
| ~~D-15~~ | CSP was report-only — i.e. advisory, enforcing nothing | ADR-026 | **Closed 2026-08-22** — see ADR-026. Enforced on every response, at two strengths, because a nonce and a prerendered page are mutually exclusive. The old trigger ("once the sink shows it clean") rested on a false premise: the policy was never clean and could not be. 14 e2e assertions; verified by walking the app in a browser against the live report sink |
| D-19 | No scheduled job runs on the server — the crontab is not installed | ADR-012 | **Routes done and proven** (2026-08-21: every job runs, idempotent on a second pass, zero errors) and the install is one command, `deploy/install-cron.sh`. **EIGHT jobs now** — `scribe-recover` (ADR-020) and `log-retention` (ADR-023) joined the original six, so `core` is 6 and `all` is 8; re-check the count against the `JOBS` table in the script rather than trusting prose. **Installing stays on hold** (owner's direction), safe ONLY while pre-launch: with no live clinics they are all no-ops. Unhold in TWO parts — **First live clinic** → `sudo ./deploy/install-cron.sh core` (the 6 pure-DB jobs, gated on real data rather than keys). **WhatsApp keys** → `…install-cron.sh all` (`recalls` + `reminders` are the only two needing an API; none need Whisper/Claude). Two not to miss: `reconcile`, because ADR-016 deliberately leaves the payment path best-effort *on the basis that* drift is repaired nightly — skip it and a failed ledger write stays wrong forever; and `scribe-recover`, without which a died-mid-transcription visit leaves the doctor on a spinner with no way back (ADR-020) |

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
`scripts/test-trash-paging.ts`)** · **D-12 reports aggregating unbounded row sets (ADR-025, closed 2026-08-22 — `scripts/test-report-aggregation.ts`)** · **D-01 app files
querying the DB directly, all 77 of them (ADR-014, closed 2026-08-22 —
`scripts/test-admin-clinics.ts`; the lint exemption block is deleted)** · **D-15 an
advisory report-only CSP (ADR-026, closed 2026-08-22 — enforced at two strengths;
14 e2e assertions)**.

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
