import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/core/db/schema";

/**
 * Tenant-scope guard — CORE defense-in-depth for the query layer. Multi-tenancy is
 * enforced by `byClinic()` on every tenant query (that is the real boundary). This
 * guard is the backstop: it inspects each SQL statement the pool runs and flags any
 * that touch a `clinic_id` table WITHOUT a `clinic_id` anywhere in the statement —
 * i.e. a forgotten scope that could leak across clinics.
 *
 * Chosen over Postgres RLS (2026-07-21): it targets the exact failure mode (a dev
 * forgets a filter) with zero architectural change — no per-request DB session, no
 * connection pinning, no serialised parallelism. See docs/todo.md §B.
 *
 * Intentional cross-tenant queries (super admin across clinics, crons) wrap in
 * `unscoped(reason, fn)`. Default behaviour is WARN (telemetry, never breaks prod);
 * set `TENANT_GUARD_STRICT=1` (tests/CI) to THROW on a violation instead.
 */

// The identity table is deliberately NOT guarded: `users` has a clinic_id, but it's
// legitimately looked up by session/username/id (auth) BEFORE any clinic is known —
// guarding it would false-positive on every authenticated request. Staff-listing
// queries still scope by clinic in the query layer; this only opts the table out of
// the automatic backstop.
const GUARD_EXCLUDE = new Set(["users"]);

// Tables that carry a `clinic_id` — derived from the schema so new tables are covered
// automatically. (`clinics` itself has no clinic_id and is excluded.) Module-owned
// tables aren't imported by core, so they're outside this set by design.
const TENANT_TABLES: string[] = (() => {
  const names: string[] = [];
  for (const v of Object.values(schema)) {
    if (is(v, PgTable)) {
      const cfg = getTableConfig(v);
      if (!GUARD_EXCLUDE.has(cfg.name) && cfg.columns.some((c) => c.name === "clinic_id")) {
        names.push(cfg.name);
      }
    }
  }
  return names;
})();

// One regex matching `from|join|into|update <tenant table>` (quoted or not).
const TENANT_RE =
  TENANT_TABLES.length > 0
    ? new RegExp(
        `(?:from|join|into|update)\\s+"?(${TENANT_TABLES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})"?\\b`,
        "i",
      )
    : null;

const unscopedStore = new AsyncLocalStorage<{ reason: string }>();

/**
 * Marks a block as an intentional cross-tenant query (super admin across clinics, a
 * cron). MUST wrap the awaited work — the context has to stay active until the query
 * actually runs (Drizzle calls the guard in a later tick), so `await` inside:
 *   `await unscoped("admin: all clinics", () => db.select()...)`
 * The `async () => await fn()` shape holds the ALS context across that await.
 */
export function unscoped<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  return unscopedStore.run({ reason }, async () => await fn());
}

const STRICT = process.env.TENANT_GUARD_STRICT === "1";

/**
 * Inspect one SQL statement. Fast path: if `clinic_id` appears anywhere it's scoped
 * (covers ~every real query). Otherwise, if it references a tenant table and isn't
 * inside `unscoped()`, it's a violation → throw (strict) or console.error (default).
 */
export function checkSql(text: string): void {
  if (!TENANT_RE || typeof text !== "string") return;
  const lower = text.toLowerCase();
  if (lower.includes("clinic_id")) return; // scoped — the common, cheap case
  if (unscopedStore.getStore()) return; // deliberately cross-tenant
  const m = TENANT_RE.exec(lower);
  if (!m) return; // touches no tenant table (reference tables, sessions, clinics…)

  const table = m[1];
  const err = new Error(
    `[tenant-guard] query touches "${table}" without a clinic_id scope. Add byClinic()/a clinic_id filter, or wrap an intentional cross-tenant query in unscoped("reason", …).\nSQL: ${text.slice(0, 400)}`,
  );
  if (STRICT) throw err;
  console.error(err.message);
}
