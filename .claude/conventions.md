# Conventions & security — FlexicaAI

> Coding style and the healthcare-data rules. Imported by root `CLAUDE.md` §9/§10,
> which keeps the short non-negotiable list; this file is the working detail.
>
> Structural rules (layers, dependency direction, decisions) live in
> `.claude/architecture.md`. Schema rules live in `.claude/database.md`.

---

## 1. TypeScript

- **Strict mode.** No `any` unless genuinely unavoidable — and then with a comment
  saying why. `unknown` + a narrowing check is almost always the honest alternative.
- **Small, single-purpose functions.** Name them for what they do in domain terms:
  `generateDentalNote`, not `genNote`; `recordSaleForAppointment`, not `save`.
- **Composition over inheritance.** There are no class hierarchies here and there
  should be none.
- **Derive types, don't restate them.** Row shapes come from `@/core/db/schema`
  (`Clinic`, `Patient`, `Appointment`…). A hand-written interface mirroring a table
  is a bug waiting for the next migration.
- **Const-array + union over enums** for app-level sets (`USER_ROLES`,
  `PERM_ACTIONS`), so the values and the type stay in one declaration.

## 2. Comments — the WHY, never the what

This is the convention that has kept a 67k-line codebase tractable, and it is worth
protecting. A comment explains **why the code is like this**: the constraint, the
alternative rejected, the bug it prevents.

```ts
// WHY: ... in dev, opening a dynamic-segment route makes Next fork a separate
// child process ... On Windows that cold fork is fragile and dies under memory
// pressure. Running the worker as a THREAD removes the crash.
```

That comment saves the next person a day. `// set the status` saves nobody anything.

Comment density should match the surrounding file. Non-obvious logic gets a brief
note above it; obvious logic gets none.

## 3. Server / client boundary

- **`import "server-only"`** at the top of anything that must never reach the browser
  — every module touching the DB, secrets, or the filesystem. It turns a leak into a
  build error.
- **Server Components by default.** `"use client"` only for genuine interactivity.
- **Mutations go through Server Actions or Route Handlers.** The browser never talks
  to Postgres.
- **Keep shared logic PURE.** `core/appointments/fee.ts` and `core/auth/permissions.ts`
  have no DB and no `server-only` import, so the server guard and the client form use
  one implementation. That is why the booking form and the ledger can't disagree.
  When logic must be shared with the client, this is the pattern — not duplication.

## 4. Validation

- **zod at every boundary** — Server Actions and Route Handlers both. Parse the raw
  `FormData`/JSON into a typed object; never read untyped fields straight into a query.
- `core/lib/zod-error.ts#zodErrorMessage` renders the first issue for the user.
- **jsonb is not an exemption.** Anything written into a `jsonb` column from client
  input is validated and BOUNDED first — shape where the app reads it, plus size and
  depth always (`core/clinical/note-schema.ts`). An unbounded object from a browser is
  both a storage-abuse vector and arbitrary structure in a medical record.
- Validation failure returns a user-facing message; it is **not** an incident and is
  not reported to the observability sink.

## 5. Actions and return shapes

- A Server Action returns `{ error: string }` or `{ ok: true, … }` — never throws for
  an expected outcome. Throwing is for genuine faults.
- Authorization is the **first** statement, via `core/auth` (`requireWorkspace` /
  `apiRequireWorkspace`). Never hand-roll a check.
- The action owns `revalidatePath`; core domain functions never call it.
- **A controlled checkbox in a Server Action form needs `ref={syncChecked(v)}`**
  (`core/ui/checkbox-sync.ts`). React RESETS the form once the action completes, and a
  reset restores each checkbox to its `defaultChecked` — which React writes on the first
  render only. A box the user has toggled since has an unchanged `checked` prop across
  the post-action re-render, so React writes nothing and the reset value wins: the tick
  reverts to how it first painted while React state and the hidden input keep the new
  value, and the form starts contradicting itself. Hidden inputs do NOT need this
  (React keeps `defaultValue` in step) and neither does a form that redirects on submit.
- **A form announces its result with `useActionToast(state, { saved, error })`**
  (`core/ui/toast.tsx`), and **what a submission DOES belongs inside the action** —
  not in an effect watching `state.saved` for it to have happened. `useActionState`
  hands back a new state object per submission carrying the same message, so
  `{state.saved ? <Toast …/> : null}` fires once and is silent on every save after
  it; twenty-one forms had each answered that with a nonce bumped from an effect,
  which is a second render per submit and the whole of
  `react-hooks/set-state-in-effect`. The hook keys on the state object's IDENTITY and
  pushes to the toast store, which is an external store — exactly what an effect is
  for — so there is no React state left to update. Each outcome is opted into,
  because several forms print their error beside the field instead.
  **Clearing the form, closing the dialog, refreshing a preview: all of it goes in
  the action**, awaited after the server call. An effect on `state.saved` also
  LATCHES — the flag stays true, so a second identical save changes nothing and the
  dialog stays open.

## 6. Database access

- **`byClinic()` on every tenant query, `notDeleted()` on every read** of a
  soft-deletable table. Both, always. (`.claude/database.md` §1)
- Cross-tenant work (super admin, crons) wraps in `unscoped("reason", …)` — explicit
  and greppable, never silent.
- **A route group is not a library** (ADR-019). If two groups need the same file, it
  belongs in `core/ui` (presentation) or `core/<domain>` (logic) — never imported
  across `src/app/<group>` boundaries. **A Server Action several panels share counts:**
  it goes in `core/<domain>/actions.ts`, like `core/auth/actions.ts` and
  `core/account/actions.ts`. Calling `revalidatePath` there is fine — the "core never
  revalidates" rule below is about DOMAIN modules, not the action layer.
- **Core may not import `app/`, `config/` or `modules/`** (architecture §3). Core
  cannot know a specialty exists, so a module's contribution is INJECTED: the registry
  aggregates it and the app hands it down (`config/module-scribe.ts`,
  `config/module-trash.ts`, `moduleVocabularies()`).
- **Both of the above are lint-enforced** (ADR-029), with type-only imports exempt.
  The counts are zero; a violation fails the build rather than waiting to be noticed —
  which is how the two that ADR-029 fixed survived as long as they did.
- **Charts come from `core/ui/charts`, and the TYPE is chosen by what the data
  says**, not by what the last chart on the page used:
  `TrendChart` for a flow over time (revenue, expenses, usage) · `ProfitLossChart`
  where the series crosses zero and the crossing is the point · `DonutChart` for
  parts of ONE whole, few enough to tell apart · `HBarChart` for a ranking across
  named things · `WaterfallChart` for how one total became another · `Sparkline`
  inside a `StatCard`. Three rules hold the set together:
  1. **A card shows a shape only when a shape exists.** No series, no sparkline; no
     baseline, no delta. Most figures here have no history (a day book is one day, a
     receivable is a balance) and a flat line drawn to tidy a grid is a lie. Where a
     series DOES exist it is nearly always already on the page — check the report's
     buckets before adding a query.
     **And when it does exist, it must ARRIVE at the figure it sits under.** A series
     that ends somewhere other than the number above it, or sums to something else, is
     worse than no series: it is two contradictory claims in one card. Build it so
     that holds by construction rather than by care — `getSalesSummary` totals the
     very rows it buckets, and `getPayableTrend` takes the lifetime balances as its
     anchor and subtracts in-window movement to find the opening, instead of re-summing
     the balance formula from scratch (which would be a second copy of a money rule,
     ADR-015). `scripts/test-dashboard-trends.ts` asserts both relationships against
     every clinic in the database.
  2. **Everything on a card agrees with everything else on it.** The sparkline takes
     the delta's good/bad judgement, not its own direction: colouring by direction
     put a red trace under a green profit figure and a green one under rising
     expenses. **The delta outranks `tone`**, which was the same bug wearing a
     different hat — `tone` is a fact about the LEVEL (net profit is positive, so the
     figure is green), while the badge and the trace both describe the MOVEMENT, and
     a card toned "good" drew a green sparkline under a red −95% badge.
     **A figure with no good direction says so** (`higherIsBetter="neutral"`): the
     doctor share bill rises WITH revenue, and scoring it left a rising share bill
     green beside a rising expense line red, both printed as money out — while the
     dashboard, scoring the same figure the other way, called a FALLING share bill
     good. The same number was green on two screens for opposite reasons. Neutral
     still SHOWS the movement; it just does not applaud it.
  3. **An insight must be legible in the chart it sits under** (`insights.ts`). Each
     detector returns null unless the data supports the sentence, including a
     materiality floor — a −126 rupee month on a 40,000 axis is a true loss and an
     invisible one, and a line that appears to contradict its own chart costs more
     trust than it adds. They are computed, so they are never labelled AI.
- **Shared UI primitives live in `core/ui`, and there is exactly one of each.** The
  set is `Button` · `Input` / `Textarea` / `SelectField` / `RadioGroup` / `Checkbox` /
  `Switch` / `DatePicker`, all wrapped by **`Field`** (label + hint + error, with the a11y wiring
  done for you) · `Dialog` · `Tooltip` · `Tabs` · `DataTable` · `EmptyState` ·
  `Card` · the `charts/` set. Reach for the primitive; if it does not fit, change the
  primitive.
  **`Checkbox` vs `Switch` is not cosmetic**: a checkbox is a value you are about to
  SUBMIT, a switch is a state you are CHANGING now. Twenty raw `<input type="checkbox">`
  elements were styled with `accent-color`, which cannot carry a focus ring, an
  indeterminate mark, or a border that reads on a dark ground — and they did not agree
  with each other (`--primary` in eight, `--color-primary` in twelve, two sizes). One
  toggle had gone the other way and hand-rolled a copy of the Switch markup.
  **The failure mode this exists to stop is copying markup.** Seven files had grown
  their own copy of the Base UI `Select` trigger/popup, five their own dialog backdrop,
  and the two components meant to be canonical had two consumers between them — so a
  dropdown opened inside a dialog rendered *behind* it in five places and correctly in
  two, and nobody could tell which was the bug.
  **An `EmptyState` is for a region that would otherwise be blank** — a list, a table,
  a card's whole body — and it says what is missing and what goes there, not just that
  there is nothing (§15 of the redesign brief). A muted inline `—` in a table CELL, or
  a one-line note inside a field group, is not an empty state and should stay inline;
  the two are different things and converting every one of them would be churn.
- **A bordered box nested inside something else gets `well`, never a hardcoded
  `bg-*`.** The surface ladder is `--surface-sunken` < the page ground < `--card` <
  `--elevated`, and which way a nested box should move depends on what is BEHIND it:
  on the page ground it rises to `--card`, inside a card it recedes to
  `--surface-sunken`. Going the wrong way is worse than no fill — a card on a card is
  two identical planes with a line between them.
  **So the surface publishes and the box reads.** `.app-root` sets `--nested-surface`
  / `--nested-shadow`; `[data-slot="card"]` and `[data-slot="dialog-popup"]` flip
  them; the `well` utility (globals.css) just reads them. A component cannot decide
  this for itself — `note-editor`, `data-table`, `trash-table` and `activity-log` each
  render both ways, so anything they hardcode is wrong half the time. A static pass
  over the JSX guessed 57 of these were on the ground; rendering showed almost all
  were inside a card.
  **`well` must never also publish a value for its own children**: a custom property
  set on an element is visible to that element's own declarations, so the publish
  would be what `background-color` picked up and every well in the app would come out
  one colour.
  **This was invisible until the ground got a tint.** While the page and `--card` were
  both pure white, `rounded-lg border p-3` with no fill looked exactly like a card;
  69 containers had been written that way. Controls are the exception and keep no
  fill — an outline button, a switch track, a checkbox square, a count chip and a
  dashed drop-slot are all *supposed* to be transparent.
  **A box sitting ON a recessed panel takes `raised`, not `well`.** `well` recedes
  from what is behind it, so a well inside a well reads the same `--nested-surface`
  as its parent and paints the identical colour — two flat planes with a hairline
  between them, which is the mistake the ladder exists to prevent (the doctor's
  schedule panel and its seven weekday rows were exactly that). `raised` paints at
  card level and publishes the recess for its own children, the same relationship a
  card has with the page, so panel → rows → anything inside a row keeps alternating.
  Only on a recessed ground: on the page ground a plain `well` is already a card.
- **Every data table sits in a `TableCard`** (`core/ui/table-card.tsx`) — one surface,
  app-wide, at the owner's direction. It had previously been split: a table that WAS
  the page sat on the page ground, a table that was one section among several took a
  card. That is defensible in the abstract and it loses to the comparison people
  actually make, which is opening two pages and seeing two designs.
  `title` is for a table that needs naming because something else shares the page
  ("24 payments" under a row of KPIs). A list page whose header already carries the
  count passes none, rather than printing it twice.
  **A table's own empty state must not draw its own box.** Inside a card, a second
  bordered container reads as a mistake — `TrashTable` and `ActivityLogList` each had
  one and now render a bare `EmptyState`.
  Also fixed: a sortable column header renders its
  label inside a `<button>` — and a button does not inherit `text-transform`, because
  browsers reset it on form elements. So the sortable columns came out Title Case
  while the non-sortable ones beside them were uppercase, in the same table. Any
  header treatment applied to a `<th>` has to be repeated on the button inside it.
- **A shared component must not know your routes.** Nav lives in each panel's
  `nav.ts` and is passed to `PanelShell` as data, with gating declared on the item
  (`resource` / `cap` / `feature` / `gate`). Adding a page never edits `core/ui`.
- **Queries belong in `core/<domain>`**, not in pages or actions (ADR-014) — enforced
  by lint: `src/app/**` may not import `@/core/db` or `@/core/db/schema` (type-only
  imports are fine). The legacy allowlist reached zero on 2026-08-22 and was removed,
  so the rule now has NO exemptions. Don't reintroduce one — if a new page needs data,
  the query goes in `core`.
- **Reading the clinic row? Use `getClinic(clinicId)`.** It is request-cached, so
  repeated reads in one render collapse to a single query — an inline
  `select … from clinics` is both a lint violation and a duplicate round trip.
- **Derived state writes in ONE transaction, and joins its source's where the source
  is the triggering event** (ADR-016). A function handed a `Tx` must READ through it
  too — on the pool it cannot see the caller's uncommitted row, so it derives from
  stale data (`core/db/tx.ts`).
- **Never catch inside a transaction and carry on.** Postgres aborts the whole
  transaction on the first error, so a swallowed failure makes the *next* statement
  fail for an unrelated-looking reason. Let inner steps throw and keep ONE
  best-effort boundary, outermost.
- Drizzle by default; raw SQL on the same pool for heavy aggregation. Never a second
  `Pool`.
- **Never hard-delete.** A delete UPDATEs the soft-delete columns.
- **Money arithmetic in SQL runs in `numeric`, then casts back to `int`** (ADR-021).
  An amount column is `int4`; a percentage multiply on it overflows and Postgres
  *throws* where the TS equivalent would clamp. Cast before multiplying.
- **SQL that mirrors a TS calculation needs a test binding the two**, not a comment
  claiming it mirrors. See `scripts/test-bill-parity.ts` for the pattern: build
  randomised rows, compute both ways, assert equality.

## 7. Error handling

- **Handle errors explicitly** where they are expected: AI calls, WhatsApp, payments,
  and email all fail routinely.
- **A swallowed failure is `report()`ed, never silent** (ADR-017):

  ```ts
  } catch (e) {
    report(e, { op: "sales.recordSale", clinicId, ids: { appointmentId } });
  }
  ```

  Keep the swallow where it is correct — a WhatsApp send must not break the booking —
  but never keep the blindness.
- `op` is a **stable dotted name**; it is the grouping key for alerts, so don't
  reword it casually.
- Pass **ids, never names** (see §10 below).
- Genuinely expected outcomes stay silent: invalid form JSON, an invalid signed-link
  token, a client-side `localStorage` guard. Reporting those is noise, and noise gets
  the whole sink ignored.

## 8. Configuration

- Every env var goes through `core/lib/env.ts` (zod-validated, one place).
- **Secrets are never in client code** and never committed. `.env*` is gitignored.
- Production-required secrets are enforced at the **request boundary**, not in the
  schema: `env.ts` is imported during `next build`, which runs with
  `NODE_ENV=production`, so a required var would fail the build on any machine
  without production secrets. Fail the request instead — loud, and it can't brick a
  deploy.

---

# Security & compliance (healthcare data)

Patient data is the reason most of these rules exist. Treat a clinical record the way
you would want yours treated.

## 9. Tenant isolation

The **query layer is the boundary**: every tenant query filters `clinic_id`
(`byClinic()`), with `core/db/tenant-guard.ts` inspecting every statement as a
backstop (ADR-005). Native Postgres RLS remains a possible future defence-in-depth.

**The guard's output must stay at zero.** A recurring known violation trains people
to ignore it. Fix the query; never mute the guard. `TENANT_GUARD_STRICT=1` makes it
throw — use it in tests.

## 10. Logging and PII

- **Never log patient PII in plain text** — not to console, not to an error tracker.
- Everything goes through `core/observability`, which redacts by key (`phone`,
  `fullName`, `transcript`, `note`, …) and by pattern (numbers, emails in free text),
  and drops Postgres `detail`/`where`, which embed row values.
- **Report ids, not names.** A `patientId` identifies a row and makes a report
  actionable; a patient's name identifies a person and buys nothing.
- UUIDs are deliberately preserved through redaction — they are the debugging handle.
- Redaction is the one part of observability that does not fail safe, which is why it
  is unit-tested (`scripts/test-observability.ts`).

## 11. Access control

- Two-tier: **clinic capability ∩ user permission** (ADR-008). Both are checked by
  `can()`.
- A receptionist must not see clinical notes unless the clinic grants it. Defaults
  live in `core/auth/permissions.ts#ROLE_DEFAULTS`.
- Super-admin impersonation is **read-only** — capabilities are intersected down to
  `:view`, and the real admin's identity stays on the audit trail.
- Authorization is decided in **one** predicate (ADR-013). If you are writing an
  access check outside `core/auth`, stop.

### Searching and paging a list

- **"Which patient is this?" is ONE predicate** (`core/patients/search-sql.ts`) — name,
  phone, the clinic's imported `external_ref`, and the printable MRN. Receivables, the
  payments ledger and the invoice register each had their own copy and had already
  drifted, so the same search found a patient on one screen and missed them on another.
  A screen's own DOCUMENT number (invoice #, RCP #) is ORed on by that screen; it is
  not folded into the shared predicate.
- **A condition set reused by two queries must only name tables BOTH join.** The
  receivables search sat in conditions shared with the per-visit query, which joins
  `users` but not `patients` — every matching search 500'd with `missing FROM-clause
  entry for table "patients"`, and it hid because that query only runs once the page
  has rows. If a filter belongs to one query, build it for that query.
- **A paged list's summary is aggregated over the whole filtered set, never folded
  from the rows.** `count`/`total` computed from a page describe the page, so the
  header silently starts contradicting its own filter the moment paging is added
  (ADR-024). And an aggregate over a money expression still needs every join that
  expression reads — `appointmentNetSql` reads `users.consultation_fee`, so a summary
  selecting no user column still joins `users` or fails at runtime.

### Sessions

- **Two expiries, and they answer different questions.** `sessions.expires_at` is an
  absolute seven-day ceiling that nothing relaxes; `last_seen_at` drives the optional
  idle timeout (`company_settings.session_idle_minutes`, 0 = never, the default). Read
  the window through `getSessionIdleMinutes()`, which is TTL-cached for 60s — it sits
  on the authentication path, so a plain query would add a round trip to **every**
  request in the product to answer "no timeout" almost every time.
- **An idle session is DELETED, never just refused.** Refusing alone leaves a row that
  becomes valid again when the window is lengthened or switched off, which resurrects
  exactly the abandoned terminal the timeout exists to close.
- **Both session writes go through `after()`.** The touch and the idle delete are work
  the response does not depend on, so they belong off the render path (ADR-020's
  mechanism, same reasoning).
- **Ending sessions re-authenticates.** "Sign out other devices" asks for the password,
  because otherwise whoever is sitting at an unattended terminal can lock the real
  owner out of every other device from inside the session that should not be trusted.
  It keeps the CURRENT session deliberately — the person is using it to do the thing.

## 12. Audit trail

- **Every action touching patient data is logged** — plus logins and record views.
- Actor name and role are **snapshotted** onto the row, so it survives the user being
  renamed or deleted.
- A failed audit write is a compliance gap, so it is reported even though it is
  swallowed.
- Clinic visibility is permission-based (`clinics.log_access`); the super admin always
  sees everything.

## 13. Consent

- `patients.data_consent` and photo consent are tracked, and **photo attachments are
  withheld server-side** when photo consent is absent — enforced at the serving route,
  not merely hidden in the UI.

## 14. Encryption and residency

- **In transit:** HTTPS everywhere; TLS terminates at nginx, with HSTS set.
- **In the browser:** the CSP is **enforced** (ADR-026), set per-request in
  `src/proxy.ts` — never in `next.config.ts`, because its `script-src` depends on
  whether the response is server-rendered. Panels get a strict nonce +
  `'strict-dynamic'` policy; public pages, which may be prerendered, get
  `'self' 'unsafe-inline'`. **Never add a nonce or a hash to the public policy** —
  under CSP3 either one disables `'unsafe-inline'` and blanks every prerendered page.
  A page that needs an inline script inside a panel takes the request's `x-nonce`.
- **At rest:** enable disk/volume encryption on the server, or `pgcrypto` for specific
  fields.
- **Residency:** architected so Pakistan data can stay in a Pakistan/nearby region and
  GCC data in-region later. Nothing may assume a single global database.

## 15. Public and unauthenticated surfaces

These get extra care — they are reachable by anyone:

- **Webhooks** verify a signature or shared token, in **constant time**, and **fail
  closed in production**. An unsigned payload that drives patient self-service
  booking is an unauthenticated write path.
- **Cron endpoints** require `CRON_SECRET`, compared in constant time, and refuse to
  run unprotected in production.
- **Signed public links** (prescription PDFs) are HMAC-signed and expiring; an invalid
  token is an ordinary 404, not an incident.
- **Inbound payloads are untrusted data** — validate, and never interpolate into SQL
  (Drizzle parameterises; `sql` templates do too).
