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
- **Derive types, don't restate them.** Row shapes come from `schema.ts`
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

## 6. Database access

- **`byClinic()` on every tenant query, `notDeleted()` on every read** of a
  soft-deletable table. Both, always. (`.claude/database.md` §1)
- Cross-tenant work (super admin, crons) wraps in `unscoped("reason", …)` — explicit
  and greppable, never silent.
- **Queries belong in `core/<domain>`**, not in pages or actions (ADR-014).
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
